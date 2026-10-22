import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPlayerEvaluation, hasPlayerEvaluationAnswer } from "@/lib/playerEvaluationPresence";
import { readAllRows } from "@/lib/server/paginatedRead";

type Ratings = { motivation: number | null; difficulty: number | null; satisfaction: number | null };

export async function playerEvaluationLockedIds(db: SupabaseClient, eventId: string): Promise<Set<string>> {
  const [sessions, feedback, answers] = await Promise.all([
    readAllRows<Ratings & { user_id: string }>((from, to) => db.from("training_sessions")
      .select("id,user_id,motivation,difficulty,satisfaction").eq("club_event_id", eventId).order("id").range(from, to)),
    readAllRows<Ratings & { player_id: string }>((from, to) => db.from("club_event_player_feedback")
      .select("player_id,motivation,difficulty,satisfaction").eq("event_id", eventId).order("player_id").range(from, to)),
    readAllRows<{ player_id: string; value_json: unknown }>((from, to) => db.from("club_event_evaluation_responses")
      .select("player_id,event_criterion_id,value_json").eq("event_id", eventId).eq("respondent_role", "player")
      .order("player_id").order("event_criterion_id").range(from, to)),
  ]);
  return new Set([
    ...sessions.filter(row => hasPlayerEvaluation([row.motivation, row.difficulty, row.satisfaction])).map(row => row.user_id),
    ...feedback.filter(row => hasPlayerEvaluation([row.motivation, row.difficulty, row.satisfaction])).map(row => row.player_id),
    ...answers.filter(row => hasPlayerEvaluationAnswer(row.value_json)).map(row => row.player_id),
  ]);
}
