import type { SupabaseClient } from "@supabase/supabase-js";
import { coachRows } from "./coachRows.ts";

export type CoachPreparationRead = {
  target_event_id: string; player_id: string; source_fingerprint: string; seen_at: string;
};
export function isMissingPreparationReads(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}
export async function loadCoachPreparationReads(db: SupabaseClient, coachId: string, eventIds: string[]) {
  const rows: CoachPreparationRead[] = [];
  for (let index = 0; index < eventIds.length; index += 150) {
    let missing = false;
    const batch = await coachRows<CoachPreparationRead>(async (from, to) => {
      const result = await db.from("coach_training_preparation_reads")
        .select("target_event_id,player_id,source_fingerprint,seen_at")
        .eq("coach_id", coachId).in("target_event_id", eventIds.slice(index, index + 150))
        .order("target_event_id").order("player_id").range(from, to);
      if (isMissingPreparationReads(result.error)) { missing = true; return { data: [], error: null }; }
      return result;
    });
    if (missing) return { rows: [], available: false };
    rows.push(...batch);
  }
  return { rows, available: true };
}
