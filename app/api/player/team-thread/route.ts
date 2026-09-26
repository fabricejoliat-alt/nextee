import { NextResponse, type NextRequest } from "next/server";
import { ensurePlayerTeamThread } from "@/app/api/messages/teamThread";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const requestedPlayerId = String(url.searchParams.get("player_id") ?? "").trim();
    const requestedOrganizationId = String(url.searchParams.get("organization_id") ?? "").trim();
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId,
      requestedOrganizationId,
      mode: "communication",
    });
    const { supabaseAdmin } = access;
    const callerId = access.actorUserId;
    const playerId = access.subjectPlayerId;
    const organizationId = access.organizationId;

    const thread = await ensurePlayerTeamThread({
      supabaseAdmin,
      organizationId,
      playerId,
      createdBy: callerId,
    });

    return NextResponse.json({
      thread_id: String(thread.id),
      organization_id: String(thread.organization_id),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: playerAccessErrorStatus(error) });
  }
}
