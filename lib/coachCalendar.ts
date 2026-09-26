import type { CoachAttendanceStatus } from "@/lib/coachDebrief";

export type CoachCalendarActionState =
  | "needs_evaluation"
  | "evaluation_complete"
  | "prepare_training"
  | "view_activity";

export type CoachCalendarEventTiming = {
  event_type: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
};

export type CoachTrainingAttendeeState = {
  event_id: string;
  player_id: string;
  coach_recorded_status: CoachAttendanceStatus | null;
};

export type CoachTrainingFeedbackState = {
  event_id: string;
  player_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
};

function validTimestamp(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function coachEventEndMs(event: Pick<CoachCalendarEventTiming, "starts_at" | "ends_at" | "duration_minutes">) {
  const explicitEnd = validTimestamp(event.ends_at);
  if (explicitEnd != null) return explicitEnd;

  const start = validTimestamp(event.starts_at) ?? 0;
  const duration = typeof event.duration_minutes === "number" && event.duration_minutes > 0
    ? event.duration_minutes * 60_000
    : 0;
  return start + duration;
}

function hasThreeRatings(feedback: CoachTrainingFeedbackState | undefined) {
  return feedback != null && [feedback.engagement, feedback.attitude, feedback.performance].every(
    (rating) => Number.isInteger(rating) && Number(rating) >= 1 && Number(rating) <= 6
  );
}

export function coachTrainingEvaluationComplete(
  attendees: CoachTrainingAttendeeState[],
  feedback: CoachTrainingFeedbackState[]
) {
  if (attendees.length === 0) return false;
  const feedbackByPlayer = new Map(feedback.map((row) => [row.player_id, row]));

  return attendees.every((attendee) => {
    if (attendee.coach_recorded_status === "absent") return true;
    if (attendee.coach_recorded_status !== "present") return false;
    return hasThreeRatings(feedbackByPlayer.get(attendee.player_id));
  });
}

export function coachTrainingCompletionByEvent(
  eventIds: Iterable<string>,
  attendees: CoachTrainingAttendeeState[],
  feedback: CoachTrainingFeedbackState[]
) {
  const attendeesByEvent = new Map<string, CoachTrainingAttendeeState[]>();
  const feedbackByEvent = new Map<string, CoachTrainingFeedbackState[]>();
  attendees.forEach((row) => attendeesByEvent.set(row.event_id, [...(attendeesByEvent.get(row.event_id) ?? []), row]));
  feedback.forEach((row) => feedbackByEvent.set(row.event_id, [...(feedbackByEvent.get(row.event_id) ?? []), row]));
  const result: Record<string, boolean> = {};
  for (const eventId of eventIds) {
    result[eventId] = coachTrainingEvaluationComplete(
      attendeesByEvent.get(eventId) ?? [],
      feedbackByEvent.get(eventId) ?? []
    );
  }
  return result;
}

export function coachCalendarActionState(
  event: CoachCalendarEventTiming,
  evaluationComplete: boolean,
  nowMs: number
): CoachCalendarActionState {
  if (event.event_type !== "training") return "view_activity";
  if (coachEventEndMs(event) > nowMs) return "prepare_training";
  return evaluationComplete ? "evaluation_complete" : "needs_evaluation";
}

export function coachCalendarActionHref(state: CoachCalendarActionState, groupId: string, eventId: string) {
  const activityHref = `/coach/groups/${groupId}/planning/${eventId}`;
  return state === "needs_evaluation" || state === "evaluation_complete"
    ? `${activityHref}/debrief`
    : activityHref;
}
