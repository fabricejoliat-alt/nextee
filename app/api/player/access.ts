import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readOnceFetch } from "@/lib/readOnceFetch";
import { loadOrganizationAccessSummary } from "@/lib/server/organizationSummary";
import {
  guardianCanEdit,
  guardianCanView,
  resolvePlayerSubject,
  sortGuardianLinks,
  type GuardianAccessLink,
  type PlayerAccessMode,
} from "@/lib/playerAccessPolicy";

type GuardianRow = {
  player_id: string | null;
  is_primary: boolean | null;
  can_view: boolean | null;
  can_edit: boolean | null;
  created_at: string | null;
  relation?: string | null;
};

type MembershipRow = {
  club_id: string | null;
  role: string | null;
};

export class PlayerAccessError extends Error {
  status: 400 | 401 | 403;

  constructor(message: string, status: 400 | 401 | 403) {
    super(message);
    this.name = "PlayerAccessError";
    this.status = status;
  }
}

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort();
}

function mapGuardianLink(row: GuardianRow): GuardianAccessLink {
  return {
    playerId: String(row.player_id ?? "").trim(),
    isPrimary: row.is_primary === true,
    canView: row.can_view,
    canEdit: row.can_edit,
    createdAt: row.created_at ?? null,
  };
}

export function createPlayerAccessAdminClient() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
    global: { fetch: readOnceFetch },
  });
}

export function bearerTokenFromRequest(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

export async function requirePlayerActor(
  accessToken: string,
  supabaseAdmin: SupabaseClient = createPlayerAccessAdminClient()
) {
  if (!accessToken) throw new PlayerAccessError("Missing token", 401);

  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerError || !callerData.user) throw new PlayerAccessError("Invalid token", 401);

  const actorUserId = String(callerData.user.id ?? "").trim();
  return loadPlayerActorAuthorization(supabaseAdmin, actorUserId);
}

export async function loadPlayerActorAuthorization(supabaseAdmin: SupabaseClient, actorUserId: string) {
  const [membershipsResult, guardianLinksResult, scopesResult] = await Promise.all([
    supabaseAdmin
      .from("club_members")
      .select("club_id,role")
      .eq("user_id", actorUserId)
      .eq("is_active", true),
    supabaseAdmin
      .from("player_guardians")
      .select("player_id,is_primary,can_view,can_edit,created_at,relation")
      .eq("guardian_user_id", actorUserId),
    supabaseAdmin.from("player_guardian_scopes").select("player_id,organization_id,status,can_view,can_edit")
      .eq("guardian_user_id", actorUserId).in("status", ["active", "pending"]),
  ]);

  if (membershipsResult.error) throw new PlayerAccessError(membershipsResult.error.message, 400);
  if (guardianLinksResult.error) throw new PlayerAccessError(guardianLinksResult.error.message, 400);
  if (scopesResult.error) throw new PlayerAccessError(scopesResult.error.message, 400);

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const guardianRows = (guardianLinksResult.data ?? []) as GuardianRow[];
  const guardianLinks = sortGuardianLinks(
    guardianRows.map(row => {
      const scopes = (scopesResult.data ?? []).filter(scope => scope.player_id === row.player_id);
      return mapGuardianLink({ ...row, can_view: scopes.some(scope => scope.can_view), can_edit: scopes.some(scope => scope.can_view && scope.can_edit) });
    }).filter((link) => Boolean(link.playerId))
  );

  return {
    supabaseAdmin,
    actorUserId,
    memberships,
    actorRoles: unique(memberships.map((membership) => membership.role)),
    actorOrganizationIds: unique(memberships.map((membership) => membership.club_id)),
    guardianLinks,
    guardianRows,
  };
}

export async function resolvePlayerAccessContext(args: {
  supabaseAdmin: SupabaseClient;
  actorUserId: string;
  actorRoles: string[];
  guardianLinks: GuardianAccessLink[];
  requestedPlayerId?: string | null;
  requestedOrganizationId?: string | null;
  mode?: PlayerAccessMode;
}) {
  const selection = resolvePlayerSubject({
    actorUserId: args.actorUserId,
    actorRoles: args.actorRoles,
    guardianLinks: args.guardianLinks,
    requestedPlayerId: args.requestedPlayerId,
    mode: args.mode,
  });
  if (!selection.ok) throw new PlayerAccessError("Forbidden", 403);

  const [membershipsResult, summary] = await Promise.all([args.supabaseAdmin
    .from("club_members")
    .select("club_id")
    .eq("user_id", selection.playerId)
    .eq("role", "player")
    .eq("is_active", true),
    loadOrganizationAccessSummary(args.supabaseAdmin, args.actorUserId, selection.playerId),
  ]);
  if (membershipsResult.error) throw new PlayerAccessError(membershipsResult.error.message, 400);

  const membershipOrganizationIds = unique(
    ((membershipsResult.data ?? []) as Array<{ club_id: string | null }>).map((membership) => membership.club_id)
  );
  let organizationIds = membershipOrganizationIds.filter(id => summary.some(row => row.organization_id === id && row.accessible));
  if (organizationIds.length === 0) throw new PlayerAccessError("Player has no active organization", 403);

  const requestedOrganizationId = String(args.requestedOrganizationId ?? "").trim();
  if (requestedOrganizationId && !organizationIds.includes(requestedOrganizationId)) {
    throw new PlayerAccessError("Forbidden", 403);
  }
  if (requestedOrganizationId) organizationIds = [requestedOrganizationId];
  if (selection.isGuardianContext && (args.mode === "edit" || args.mode === "consent")) {
    const checks = await Promise.all(organizationIds.map(async id => {
      const result = await args.supabaseAdmin.rpc("organization_guardian_allowed", {
        p_actor: args.actorUserId, p_player: selection.playerId, p_org: id, p_edit: true,
      });
      if (result.error) throw new PlayerAccessError("Forbidden", 403);
      return result.data === true ? id : null;
    }));
    organizationIds = checks.filter((id): id is string => id !== null);
    if (!organizationIds.length || (requestedOrganizationId && !organizationIds.includes(requestedOrganizationId)))
      throw new PlayerAccessError("Forbidden", 403);
  }

  return {
    actorUserId: args.actorUserId,
    actorRoles: args.actorRoles,
    subjectPlayerId: selection.playerId,
    organizationIds,
    organizationId: requestedOrganizationId || organizationIds[0],
    isGuardianContext: selection.isGuardianContext,
    viewerRole: selection.isGuardianContext ? ("parent" as const) : ("player" as const),
    permissions: {
      view: selection.canView,
      edit: selection.canEdit,
    },
    guardianLink: selection.guardianLink,
  };
}

export async function resolveAuthenticatedPlayerAccess(args: {
  accessToken: string;
  requestedPlayerId?: string | null;
  requestedOrganizationId?: string | null;
  mode?: PlayerAccessMode;
  supabaseAdmin?: SupabaseClient;
}) {
  const actor = await requirePlayerActor(args.accessToken, args.supabaseAdmin);
  const context = await resolvePlayerAccessContext({
    supabaseAdmin: actor.supabaseAdmin,
    actorUserId: actor.actorUserId,
    actorRoles: actor.actorRoles,
    guardianLinks: actor.guardianLinks,
    requestedPlayerId: args.requestedPlayerId,
    requestedOrganizationId: args.requestedOrganizationId,
    mode: args.mode,
  });

  return { ...actor, ...context };
}

export function visibleGuardianLinks(links: GuardianAccessLink[]) {
  return sortGuardianLinks(links).filter(guardianCanView);
}

export function editableGuardianLinks(links: GuardianAccessLink[]) {
  return sortGuardianLinks(links).filter(guardianCanEdit);
}

export function playerAccessErrorStatus(error: unknown) {
  return error instanceof PlayerAccessError ? error.status : 500;
}
