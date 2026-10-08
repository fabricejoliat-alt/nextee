import { NextResponse, type NextRequest } from "next/server";
import { createRequestTiming } from "@/lib/server/requestTiming";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
  visibleGuardianLinks,
} from "@/app/api/player/access";

export async function GET(req: NextRequest) {
  const timing = createRequestTiming();
  try {
    const url = new URL(req.url);
    const requestedPlayerId = String(
      url.searchParams.get("child_id") ?? url.searchParams.get("player_id") ?? ""
    ).trim();
    const requestedOrganizationId = String(url.searchParams.get("organization_id") ?? "").trim();
    const access = await timing.measure("access", () => resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId,
      requestedOrganizationId,
      mode: "view",
    }));

    let home;
    if (url.searchParams.get("home") === "1") {
      const [profile, organizations, performance] = await timing.measure("profile", () => Promise.all([
        access.supabaseAdmin.from("profiles").select("id,first_name,last_name,handicap,avatar_url")
          .eq("id", access.subjectPlayerId).maybeSingle(),
        access.supabaseAdmin.from("organizations").select("id,name").in("id", access.organizationIds),
        access.supabaseAdmin.from("club_members").select("id").eq("user_id", access.subjectPlayerId)
          .eq("role", "player").eq("is_active", true).eq("is_performance", true)
          .in("club_id", access.organizationIds).limit(1),
      ]));
      for (const result of [profile, organizations, performance]) if (result.error) throw result.error;
      home = { profile: profile.data, organizations: organizations.data ?? [], performanceEnabled: Boolean(performance.data?.length) };
    }

    return NextResponse.json(
      {
        viewerUserId: access.actorUserId,
        effectiveUserId: access.subjectPlayerId,
        role: access.viewerRole,
        roles: access.actorRoles,
        childIds: access.actorRoles.includes("parent")
          ? visibleGuardianLinks(access.guardianLinks).map((link) => link.playerId)
          : [],
        organizationIds: access.organizationIds,
        organizationId: access.organizationId,
        permissions: access.permissions,
        ...(home ? { home } : {}),
      },
      { headers: { "Cache-Control": "no-store", ...timing.headers() } }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error), headers: { "Cache-Control": "no-store", ...timing.headers() } }
    );
  }
}
