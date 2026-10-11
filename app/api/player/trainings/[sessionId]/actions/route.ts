import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenFromRequest, playerAccessErrorStatus, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";

// Camp metadata is server-only. Never expose it until the session owner and
// organization scope have been checked using the common Player/Parent policy.
export async function GET(req: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: new URL(req.url).searchParams.get("child_id"),
      requestedOrganizationId: requestedOrganizationId(req.url),
      mode: "view",
    });
    const session = await access.supabaseAdmin.from("training_sessions").select("id")
      .eq("id", sessionId).eq("user_id", access.subjectPlayerId)
      .or(personalOrOrganizationFilter("club_id", access.organizationIds)).maybeSingle();
    if (session.error) throw session.error;
    if (!session.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const camp = await access.supabaseAdmin.from("player_camp_days").select("session_id").eq("session_id", sessionId).limit(1);
    if (camp.error) throw camp.error;
    return NextResponse.json({ isCampDay: Boolean(camp.data?.length) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Unable to check training actions" }, { status: playerAccessErrorStatus(error) });
  }
}
