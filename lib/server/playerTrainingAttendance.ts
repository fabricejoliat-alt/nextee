import { resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { canChangePastTrainingAttendance } from "@/lib/playerTrainingAttendanceChange";

type Access = Awaited<ReturnType<typeof resolveAuthenticatedPlayerAccess>>;

export async function readPastTrainingAttendanceState(access: Access, eventId: string) {
  const db = access.supabaseAdmin;
  const eventResult = await db.from("club_events")
    .select("id,club_id,event_type,status,starts_at,ends_at,duration_minutes")
    .eq("id", eventId).in("club_id", access.organizationIds).maybeSingle();
  if (eventResult.error) throw eventResult.error;
  if (!eventResult.data) return null;

  const [attendeeResult, sessionsResult, feedbackResult, responsesResult] = await Promise.all([
    db.from("club_event_attendees").select("status,coach_recorded_status")
      .eq("event_id", eventId).eq("player_id", access.subjectPlayerId).maybeSingle(),
    db.from("training_sessions").select("motivation,difficulty,satisfaction")
      .eq("club_event_id", eventId).eq("user_id", access.subjectPlayerId),
    db.from("club_event_coach_feedback").select("event_id")
      .eq("event_id", eventId).eq("player_id", access.subjectPlayerId).limit(1),
    db.from("club_event_evaluation_responses").select("respondent_role")
      .eq("event_id", eventId).eq("player_id", access.subjectPlayerId).in("respondent_role", ["coach", "player"]),
  ]);
  for (const result of [attendeeResult, sessionsResult, feedbackResult, responsesResult]) if (result.error) throw result.error;
  if (!attendeeResult.data) return null;

  const event = eventResult.data;
  const attendee = attendeeResult.data;
  const roles = new Set((responsesResult.data ?? []).map((row) => row.respondent_role));
  const canChange = canChangePastTrainingAttendance({
    eventType: event.event_type,
    eventStatus: event.status,
    eventStartsAt: event.starts_at,
    eventEndsAt: event.ends_at,
    eventDurationMinutes: event.duration_minutes,
    coachRecordedStatus: attendee.coach_recorded_status,
    coachFeedbackRecorded: Boolean(feedbackResult.data?.length),
    coachResponseRecorded: roles.has("coach"),
    playerRatings: (sessionsResult.data ?? []).flatMap((row) => [row.motivation, row.difficulty, row.satisfaction]),
    playerResponseRecorded: roles.has("player"),
  }, new Date());
  return { eventId, status: attendee.status, canChange };
}

export async function changePastTrainingAttendance(access: Access, state: NonNullable<Awaited<ReturnType<typeof readPastTrainingAttendanceState>>>, nextStatus: "present" | "absent") {
  let update = access.supabaseAdmin.from("club_event_attendees")
    .update({ status: nextStatus }).eq("event_id", state.eventId).eq("player_id", access.subjectPlayerId)
    .is("coach_recorded_status", null);
  update = state.status == null ? update.is("status", null) : update.eq("status", state.status);
  const result = await update.select("status").maybeSingle();
  if (result.error) throw result.error;
  return result.data?.status ?? null;
}
