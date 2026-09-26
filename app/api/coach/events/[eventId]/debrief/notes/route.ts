import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import { CoachDebriefValidationError, normalizePrivateNoteProposals } from "@/lib/coachDebrief";
import { isCoachTrainingAssistanceEnabled } from "@/lib/server/coachTrainingAssistance";

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const event = await requireCoachEventAccess(supabaseAdmin, callerId, eventId);
    if (event.event_type !== "training") return NextResponse.json({ error: "Training only" }, { status: 400 });
    if (!(await isCoachTrainingAssistanceEnabled(supabaseAdmin, event.club_id, callerId))) {
      return NextResponse.json({ error: "Training assistance is disabled for this coach." }, { status: 403 });
    }

    const attendeesRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id,coach_recorded_status")
      .eq("event_id", eventId);
    if (attendeesRes.error) throw new Error(attendeesRes.error.message);
    const presentIds = (attendeesRes.data ?? [])
      .filter((row: { coach_recorded_status: string | null }) => row.coach_recorded_status === "present")
      .map((row: { player_id: string }) => row.player_id);

    const body = await req.json().catch(() => ({}));
    const proposals = normalizePrivateNoteProposals(body, presentIds);
    const reportVersion = Number(body?.report_version);
    if (!Number.isInteger(reportVersion) || reportVersion < 1) {
      return NextResponse.json({ error: "The analyzed report version is missing." }, { status: 400 });
    }
    const saveRes = await supabaseAdmin.rpc("validate_coach_training_private_notes", {
      p_event_id: eventId,
      p_coach_id: callerId,
      p_proposals: proposals,
      p_report_version: reportVersion,
    });
    if (saveRes.error) throw new Error(saveRes.error.message);
    return NextResponse.json({ ok: true, inserted: Number(saveRes.data ?? 0) });
  } catch (error: unknown) {
    if (error instanceof CoachDebriefValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Server error";
    const status = message === "forbidden" ? 403 : message === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
