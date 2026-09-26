import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
  visibleGuardianLinks,
} from "@/app/api/player/access";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const requestedPlayerId = String(
      url.searchParams.get("child_id") ?? url.searchParams.get("player_id") ?? ""
    ).trim();
    const requestedOrganizationId = String(url.searchParams.get("organization_id") ?? "").trim();
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId,
      requestedOrganizationId,
      mode: "view",
    });

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
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error), headers: { "Cache-Control": "no-store" } }
    );
  }
}
