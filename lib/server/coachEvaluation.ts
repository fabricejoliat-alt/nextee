import type { SupabaseClient } from "@supabase/supabase-js";
import { coachTrainingCompletionByEvent, coachTrainingEvaluationComplete, type CoachTrainingAttendeeState, type CoachTrainingFeedbackState,
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

type EvaluationState = {
  attendees: CoachTrainingAttendeeState[]; feedback: CoachTrainingFeedbackState[];
  criteria: EventEvaluationCriterion[]; responses: CoachEvaluationResponseState[]; completeByEvent: Record<string, boolean>;
};

export async function loadCoachEvaluationState(db: SupabaseClient, eventIds: string[]): Promise<EvaluationState> {
  if (!eventIds.length) return { attendees: [], feedback: [], criteria: [], responses: [], completeByEvent: {} };
  if (eventIds.length > 150) {
    const combined: EvaluationState = { attendees: [], feedback: [], criteria: [], responses: [], completeByEvent: {} };
    for (let from = 0; from < eventIds.length; from += 150) {
      const batch = await loadCoachEvaluationState(db, eventIds.slice(from, from + 150));
      combined.attendees.push(...batch.attendees); combined.feedback.push(...batch.feedback);
      combined.criteria.push(...batch.criteria); combined.responses.push(...batch.responses);
      Object.assign(combined.completeByEvent, batch.completeByEvent);
    }
    return combined;
  }
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

type EvaluationProgress = { totalPlayers: number; completedPlayers: number; remainingPlayers: number };

/** Current work only. Keep the raw loader above for saved history and attendance locks.
 * Consent is checked by the same organization predicate as the evaluation write gate,
 * including the latest authorization version, adult eligibility and active membership.
 */
export async function loadCoachEvaluationWorkload(db: SupabaseClient, eventIds: string[]) {
  const ids = [...new Set(eventIds)];
  const state = await loadCoachEvaluationState(db, ids);
  const events: Array<{ id: string; club_id: string }> = [];
  for (let from = 0; from < ids.length; from += 150) {
    events.push(...await allRows<{ id: string; club_id: string }>((start, end) => db.from("club_events")
      .select("id,club_id").in("id", ids.slice(from, from + 150)).order("id").range(start, end)));
  }
  const organizationByEvent = new Map(events.map(event => [event.id, event.club_id]));
  const pairs = new Map<string, { organizationId: string; playerId: string }>();
  const pairKey = (organizationId: string, playerId: string) => `${organizationId}:${playerId}`;
  for (const attendee of state.attendees) {
    const organizationId = organizationByEvent.get(attendee.event_id);
    if (!organizationId) throw new Error("Evaluation organization unavailable");
    pairs.set(pairKey(organizationId, attendee.player_id), { organizationId, playerId: attendee.player_id });
  }

  const suspended = new Set<string>();
  const organizations = [...new Set([...pairs.values()].map(pair => pair.organizationId))];
  for (let from = 0; from < organizations.length; from += 150) {
    const rows = await allRows<{ academy_id: string; player_id: string }>((start, end) => db.from("academy_roster_entries")
      .select("academy_id,player_id").in("academy_id", organizations.slice(from, from + 150))
      .neq("status", "active").order("academy_id").order("player_id").range(start, end));
    rows.forEach(row => suspended.add(pairKey(row.academy_id, row.player_id)));
  }
  const allowed = new Set<string>();
  const candidates = [...pairs.entries()].filter(([key]) => !suspended.has(key));
  // One check per junior/organization, not per historical session; cap concurrency.
  for (let from = 0; from < candidates.length; from += 8) {
    await Promise.all(candidates.slice(from, from + 8).map(async ([key, pair]) => {
      const result = await db.rpc("organization_player_authorized", { p_org: pair.organizationId, p_player: pair.playerId });
      if (result.error) throw new Error(result.error.message);
      if (result.data === true) allowed.add(key);
    }));
  }
  const attendees = state.attendees.filter(row => allowed.has(pairKey(organizationByEvent.get(row.event_id)!, row.player_id)));
  const eligiblePairs = new Set(attendees.map(row => `${row.event_id}:${row.player_id}`));
  const feedback = state.feedback.filter(row => eligiblePairs.has(`${row.event_id}:${row.player_id}`));
  const responses = state.responses.filter(row => eligiblePairs.has(`${row.event_id}:${row.player_id}`));
  const progressByEvent: Record<string, EvaluationProgress> = {};
  for (const id of ids) {
    const players = attendees.filter(row => row.event_id === id);
    const completedPlayers = players.filter(player => coachTrainingEvaluationComplete([player],
      feedback.filter(row => row.event_id === id), state.criteria, responses)).length;
    progressByEvent[id] = { totalPlayers: players.length, completedPlayers, remainingPlayers: players.length - completedPlayers };
  }
  return { ...state, attendees, feedback, responses, progressByEvent,
    completeByEvent: Object.fromEntries(Object.entries(progressByEvent).map(([id, progress]) =>
      [id, progress.totalPlayers > 0 && progress.remainingPlayers === 0])) };
}
