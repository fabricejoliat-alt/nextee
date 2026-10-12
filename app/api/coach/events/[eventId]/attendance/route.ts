import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCaller } from "@/app/api/messages/_lib";
import { canCoachAccessEvent, requireCoachEventPlayer } from "@/lib/coachAccess";
import { coachPlayerEvaluationComplete, validCoachCriterionValue } from "@/lib/coachCalendar";
import { loadCoachEvaluationState } from "@/lib/server/coachEvaluation";

async function context(req: NextRequest, eventId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { callerId } = await requireCaller(token);
  const { data: event, error } = await db.from("club_events").select("id,group_id,club_id,event_type,status").eq("id", eventId).maybeSingle();
  if (error || !event || !(await canCoachAccessEvent(db, callerId, eventId, event.group_id, event.club_id))) return null;
  return { db, event, callerId };
}

async function lockedPlayers(db: NonNullable<Awaited<ReturnType<typeof context>>>["db"], eventId: string) {
  const [playerFeedback, playerResponses, coachState] = await Promise.all([
    db.from("club_event_player_feedback").select("player_id,motivation,difficulty,satisfaction,submitted_at").eq("event_id", eventId),
    db.from("club_event_evaluation_responses").select("player_id,event_criterion_id,value_json").eq("event_id", eventId).eq("respondent_role", "player"),
    loadCoachEvaluationState(db, [eventId]),
  ]);
  if (playerFeedback.error) throw playerFeedback.error;
  if (playerResponses.error) throw playerResponses.error;
  const criteria = coachState.criteria.filter((row) => row.event_id === eventId);
  const requiredPlayerCriteria = criteria.filter((row) => row.is_enabled && row.snapshot_is_required
    && ["player", "both"].includes(row.snapshot_respondent));
  const completedPlayerIds = new Set((playerFeedback.data ?? []).filter((row) => row.submitted_at
    && [row.motivation, row.difficulty, row.satisfaction].every((value) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6)
    && requiredPlayerCriteria.every((criterion) => validCoachCriterionValue(criterion,
      playerResponses.data?.find((response) => response.player_id === row.player_id && response.event_criterion_id === criterion.id)?.value_json)))
    .map((row) => row.player_id));
  return coachState.attendees.filter((attendee) => completedPlayerIds.has(attendee.player_id) && coachPlayerEvaluationComplete(
    attendee.coach_recorded_status,
    (() => { const row = coachState.feedback.find((item) => item.event_id === eventId && item.player_id === attendee.player_id);
      return [row?.engagement ?? null, row?.attitude ?? null, row?.performance ?? null]; })(),
    criteria,
    Object.fromEntries(coachState.responses.filter((response) => response.player_id === attendee.player_id)
      .map((response) => [response.event_criterion_id, response.value_json]))
  )).map((row) => row.player_id);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await ctx.params;
    const scope = await context(req, eventId);
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ lockedPlayerIds: await lockedPlayers(scope.db, eventId) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Attendance unavailable" }, { status: 503 }); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await ctx.params;
    const scope = await context(req, eventId);
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    if (scope.event.event_type !== "training" || scope.event.status === "cancelled"
      || typeof body.playerId !== "string" || !["present", "absent"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid attendance" }, { status: 400 });
    }
    const attendee = await scope.db.from("club_event_attendees").select("player_id").eq("event_id", eventId).eq("player_id", body.playerId).maybeSingle();
    if (attendee.error || !attendee.data) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    await requireCoachEventPlayer(scope.db, eventId, body.playerId, scope.callerId, scope.event.club_id);
    if ((await lockedPlayers(scope.db, eventId)).includes(body.playerId)) {
      return NextResponse.json({ error: "Les deux évaluations sont terminées : la présence est verrouillée." }, { status: 409 });
    }
    const updated = await scope.db.from("club_event_attendees").update({ status: body.status, coach_recorded_status: body.status })
      .eq("event_id", eventId).eq("player_id", body.playerId).select("player_id").single();
    if (updated.error) throw updated.error;
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Attendance update failed" }, { status: 503 }); }
}
