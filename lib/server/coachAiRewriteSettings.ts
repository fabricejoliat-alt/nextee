import type { SupabaseClient } from "@supabase/supabase-js";
import { COACH_REWRITE_INSTRUCTIONS_MAX } from "../coachAiRewriteInstructions.ts";

export async function loadCoachRewriteSettings(db: SupabaseClient) {
  const result = await db.from("coach_ai_rewrite_settings").select("instructions,revision,updated_at").eq("singleton", true).single();
  if (result.error || !result.data || typeof result.data.instructions !== "string"
    || result.data.instructions.trim().length < 20 || result.data.instructions.length > COACH_REWRITE_INSTRUCTIONS_MAX
    || !Number.isSafeInteger(result.data.revision) || result.data.revision < 1) {
    throw new Error("Rewrite instructions unavailable");
  }
  return result.data as { instructions: string; revision: number; updated_at: string };
}
