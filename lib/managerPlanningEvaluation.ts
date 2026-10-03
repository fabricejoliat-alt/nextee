import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachTrainingAttendeeState, CoachTrainingFeedbackState, CoachEvaluationCriterionState, CoachEvaluationResponseState } from "./coachCalendar";
import { managerEvaluationProgress } from "./managerEvaluationProgress";

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []) as T[]);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}
/** Manager completion includes all coaches and required custom criteria, like the dashboard. */
export async function managerPlanningPendingEvents(db: SupabaseClient, eventIds: string[]) {
  const pending = new Set<string>();
  for (let from = 0; from < eventIds.length; from += 150) {
    const ids = eventIds.slice(from, from + 150);
    const [attendees, feedback, criteria, responses] = await Promise.all([
      allRows<CoachTrainingAttendeeState>((a,b) => db.from("club_event_attendees").select("event_id,player_id,coach_recorded_status").in("event_id", ids).order("event_id").order("player_id").range(a,b)),
      allRows<CoachTrainingFeedbackState>((a,b) => db.from("club_event_coach_feedback").select("event_id,player_id,engagement,attitude,performance").in("event_id", ids).order("event_id").order("player_id").order("coach_id").range(a,b)),
      allRows<CoachEvaluationCriterionState>((a,b) => db.from("club_event_evaluation_criteria").select("id,event_id,is_enabled,snapshot_respondent,snapshot_is_required,snapshot_response_format,snapshot_choices").in("event_id", ids).eq("is_enabled", true).order("event_id").order("id").range(a,b)),
      allRows<CoachEvaluationResponseState>((a,b) => db.from("club_event_evaluation_responses").select("event_id,player_id,event_criterion_id,respondent_role,value_json").in("event_id", ids).eq("respondent_role", "coach").order("event_id").order("id").range(a,b)),
    ]);
    const progress = managerEvaluationProgress(attendees, feedback, criteria, responses);
    for (const row of attendees) if (!progress.completed.has(`${row.event_id}|${row.player_id}`)) pending.add(row.event_id);
  }
  return pending;
}
