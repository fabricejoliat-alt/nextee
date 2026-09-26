import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import {
  CoachDebriefValidationError,
  normalizeCoachPlayerEvaluationInput,
} from "@/lib/coachDebrief";

function httpError(message: string) {
  if (message === "event_not_found") return { status: 404, message: "Training not found." };
  if (message === "forbidden") return { status: 403, message: "Forbidden" };
  return { status: 400, message };
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const event = await requireCoachEventAccess(supabaseAdmin, callerId, eventId);
    if (event.event_type !== "training") {
      return NextResponse.json({ error: "Only training sessions can be evaluated." }, { status: 400 });
    }

    const normalized = normalizeCoachPlayerEvaluationInput(await req.json().catch(() => ({})));
    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id")
      .eq("event_id", eventId)
      .eq("player_id", normalized.player_id)
      .maybeSingle();
    if (attendeeRes.error) throw new Error(attendeeRes.error.message);
    if (!attendeeRes.data) {
      return NextResponse.json({ error: "Player is not part of this session." }, { status: 400 });
    }

    const saveRes = await supabaseAdmin.rpc("save_coach_training_player_evaluation_v1", {
      p_event_id: eventId,
      p_coach_id: callerId,
      p_player_id: normalized.player_id,
      p_status: normalized.status,
      p_engagement: normalized.engagement,
      p_attitude: normalized.attitude,
      p_performance: normalized.performance,
      p_source_text: normalized.player_note,
      p_private_note: normalized.private_note,
      p_update_comment: normalized.status === "present",
    });
    if (saveRes.error) throw new Error(saveRes.error.message);

    const result = (saveRes.data && typeof saveRes.data === "object" ? saveRes.data : {}) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      debriefId: result.debrief_id ?? null,
      reportVersion: Number(result.report_version ?? 0) || null,
      noteInserted: result.note_inserted === true,
    });
  } catch (error: unknown) {
    if (error instanceof CoachDebriefValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Server error";
    const mapped = httpError(message);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
