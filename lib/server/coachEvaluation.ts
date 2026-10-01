import type { SupabaseClient } from "@supabase/supabase-js";
import { coachTrainingCompletionByEvent, type CoachTrainingAttendeeState, type CoachTrainingFeedbackState,
  type CoachEvaluationResponseState } from "@/lib/coachCalendar";
import type { EventEvaluationCriterion } from "@/lib/evaluationCriteria";

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []) as T[]);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}

export async function loadCoachEvaluationState(db: SupabaseClient, eventIds: string[]) {
  if (!eventIds.length) return { attendees: [], feedback: [], criteria: [], responses: [], completeByEvent: {} };
  const [attendees, feedback, criteria, responses] = await Promise.all([
    allRows<CoachTrainingAttendeeState>((from,to) => db.from("club_event_attendees").select("event_id,player_id,coach_recorded_status")
      .in("event_id", eventIds).order("event_id").order("player_id").range(from,to)),
    allRows<CoachTrainingFeedbackState>((from,to) => db.from("club_event_coach_feedback").select("event_id,player_id,engagement,attitude,performance")
      .in("event_id", eventIds).order("event_id").order("player_id").order("coach_id").range(from,to)),
    allRows<EventEvaluationCriterion>((from,to) => db.from("club_event_evaluation_criteria").select("*").in("event_id", eventIds)
      .eq("is_enabled", true).order("event_id").order("position").order("id").range(from,to)),
    allRows<CoachEvaluationResponseState>((from,to) => db.from("club_event_evaluation_responses").select("event_id,player_id,event_criterion_id,respondent_role,value_json")
      .in("event_id", eventIds).eq("respondent_role", "coach").order("event_id").order("id").range(from,to)),
  ]);
  return { attendees, feedback, criteria, responses,
    completeByEvent: coachTrainingCompletionByEvent(eventIds, attendees, feedback, criteria, responses) };
}
