import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { ensurePlayerTeamThread } from "@/app/api/messages/teamThread";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    if (access.sharedClubIds.length === 0 || !access.canAccessSensitiveSections) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const requestedOrganizationId = String(
      new URL(req.url).searchParams.get("organization_id") ?? ""
    ).trim();
    const allowedOrganizationIds = [...access.sharedClubIds].sort();
    if (requestedOrganizationId && !allowedOrganizationIds.includes(requestedOrganizationId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const organizationId = requestedOrganizationId || allowedOrganizationIds[0] || "";
    if (!organizationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
