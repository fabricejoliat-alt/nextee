import { coachPlayerEvaluationComplete, type CoachTrainingAttendeeState, type CoachTrainingFeedbackState,
  type CoachEvaluationCriterionState, type CoachEvaluationResponseState } from "./coachCalendar";

export function managerEvaluationProgress(
  attendees: CoachTrainingAttendeeState[], feedback: CoachTrainingFeedbackState[],
  criteria: CoachEvaluationCriterionState[], responses: CoachEvaluationResponseState[]
) {
  const key = (row: { event_id: string; player_id: string }) => `${row.event_id}|${row.player_id}`;
  const ratingsByPair = new Map(feedback.map((row) => [key(row), row]));
  const completed = new Set<string>(), inProgress = new Set<string>();
  for (const attendee of attendees) {
    const pair = key(attendee), ratings = ratingsByPair.get(pair);
    const answers = responses.filter((row) => key(row) === pair && row.respondent_role === "coach");
    if (coachPlayerEvaluationComplete(attendee.coach_recorded_status,
      ratings ? [ratings.engagement, ratings.attitude, ratings.performance] : [],
      criteria.filter((row) => row.event_id === attendee.event_id),
      Object.fromEntries(answers.map((row) => [row.event_criterion_id, row.value_json])))) completed.add(pair);
    else if (attendee.coach_recorded_status || ratings || answers.length) inProgress.add(pair);
  }
  return { completed, inProgress };
}
