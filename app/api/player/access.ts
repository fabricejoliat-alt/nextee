import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  const [membershipsResult, guardianLinksResult] = await Promise.all([
    supabaseAdmin
      .from("club_members")
      .select("club_id,role")
      .eq("user_id", actorUserId)
      .eq("is_active", true),
    supabaseAdmin
      .from("player_guardians")
      .select("player_id,is_primary,can_view,can_edit,created_at,relation")
      .eq("guardian_user_id", actorUserId),
  ]);

  if (membershipsResult.error) throw new PlayerAccessError(membershipsResult.error.message, 400);
  if (guardianLinksResult.error) throw new PlayerAccessError(guardianLinksResult.error.message, 400);

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const guardianRows = (guardianLinksResult.data ?? []) as GuardianRow[];
  const guardianLinks = sortGuardianLinks(
    guardianRows.map(mapGuardianLink).filter((link) => Boolean(link.playerId))
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

  const membershipsResult = await args.supabaseAdmin
    .from("club_members")
    .select("club_id")
    .eq("user_id", selection.playerId)
    .eq("role", "player")
    .eq("is_active", true);
  if (membershipsResult.error) throw new PlayerAccessError(membershipsResult.error.message, 400);

  const organizationIds = unique(
    ((membershipsResult.data ?? []) as Array<{ club_id: string | null }>).map((membership) => membership.club_id)
  );
  if (organizationIds.length === 0) throw new PlayerAccessError("Player has no active organization", 403);

  const requestedOrganizationId = String(args.requestedOrganizationId ?? "").trim();
  if (requestedOrganizationId && !organizationIds.includes(requestedOrganizationId)) {
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
