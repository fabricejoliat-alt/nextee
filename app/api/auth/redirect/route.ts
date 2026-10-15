import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadOrganizationAccessSummary } from "@/lib/server/organizationSummary";
import { loadPlayerActorAuthorization, visibleGuardianLinks } from "@/app/api/player/access";
import { selectPrimaryApplicationRole } from "@/lib/playerAccessPolicy";
import { pendingEditableParentChildren } from "@/lib/server/parentConsentRequirements";

async function resolvePlayerConsentPending(supabaseAdmin: SupabaseClient, userId: string) {
  const membershipsRes = await supabaseAdmin
    .from("club_members")
    .select("club_id,player_consent_status")
    .eq("user_id", userId)
    .eq("role", "player")
    .eq("is_active", true);
  if (membershipsRes.error) throw new Error(membershipsRes.error.message);
  const memberships = (membershipsRes.data ?? []) as Array<{ club_id: string; player_consent_status: string | null }>;
  const summary = await loadOrganizationAccessSummary(supabaseAdmin, userId);
  if (summary.some(row => row.accessible)) return { pending: false, consentRequired: false, playerProfileRequired: false, pendingClubNames: [] as string[] };
  const clubIds = [...new Set(memberships.map(row => row.club_id))];
  const clubs = clubIds.length ? await supabaseAdmin.from("organizations").select("id,name,is_active").in("id", clubIds).eq("is_active", true)
    : { data: [], error: null };
  if (clubs.error) throw new Error(clubs.error.message);
  const checks = await Promise.all(memberships.filter(row => clubs.data?.some(club => club.id === row.club_id)).map(async row => {
    // Personal document readiness must not be mistaken for missing parental authorization.
    const result = await supabaseAdmin.rpc("organization_player_authorized", { p_org: row.club_id, p_player: userId });
    if (result.error || typeof result.data !== "boolean") throw new Error("Impossible de vérifier l’autorisation du joueur.");
    return { ...row, authorized: result.data };
  }));
  const parentMissing = checks.filter(row => !row.authorized && row.player_consent_status !== "adult");
  return { pending: true, consentRequired: parentMissing.length > 0,
    playerProfileRequired: checks.some(row => !row.authorized && row.player_consent_status === "adult"),
    pendingClubNames: parentMissing.map(row => clubs.data?.find(club => club.id === row.club_id)?.name ?? "votre club") };
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Qui est-ce ? (à partir du token utilisateur)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = userData.user.id;

    // Superadmin ?
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (adminErr) {
      return NextResponse.json({ error: adminErr.message }, { status: 400 });
    }

    const resHeaders = { "Cache-Control": "no-store" as const };

    if (adminRow) {
      return NextResponse.json({ redirectTo: "/admin" }, { headers: resHeaders });
    }

    const actor = await loadPlayerActorAuthorization(supabaseAdmin, userId);
    const role = selectPrimaryApplicationRole(actor.actorRoles);
    if (!role) {
      return NextResponse.json({ redirectTo: "/no-access" }, { headers: resHeaders });
    }

    if (role === "manager") return NextResponse.json({ redirectTo: "/manager" }, { headers: resHeaders });
    if (role === "coach") return NextResponse.json({ redirectTo: "/coach" }, { headers: resHeaders });
    if (role === "parent") {
      const links = visibleGuardianLinks(actor.guardianLinks);
      if (links.length === 0) {
        return NextResponse.json({ redirectTo: "/no-access" }, { headers: resHeaders });
      }
      const pendingChildIds = await pendingEditableParentChildren(supabaseAdmin, links, userId);
      if (pendingChildIds.length && !(await loadOrganizationAccessSummary(supabaseAdmin, userId)).some(row => row.accessible)) return NextResponse.json({ redirectTo: "/legal/my", parentConsentRequired: true,
        pendingChildIds }, { headers: resHeaders });
      return NextResponse.json({ redirectTo: "/player" }, { headers: resHeaders });
    }
    if (role === "player") {
      const consent = await resolvePlayerConsentPending(supabaseAdmin, userId);
      if (consent.pending) return NextResponse.json({ redirectTo: "/legal/my", consentRequired: consent.consentRequired,
        ...(consent.playerProfileRequired ? { playerProfileRequired: true } : {}), pendingClubNames: consent.pendingClubNames }, { headers: resHeaders });
    }
    return NextResponse.json({ redirectTo: "/player" }, { headers: resHeaders });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
