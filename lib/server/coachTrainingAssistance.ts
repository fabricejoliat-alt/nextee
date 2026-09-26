import type { SupabaseClient } from "@supabase/supabase-js";

export async function isCoachTrainingAssistanceEnabled(
  supabaseAdmin: SupabaseClient,
  organizationId: string,
  coachId: string
) {
  const normalizedId = String(organizationId ?? "").trim();
  const normalizedCoachId = String(coachId ?? "").trim();
  if (!normalizedId || !normalizedCoachId) return false;

  const result = await supabaseAdmin.rpc("is_coach_training_assistance_enabled_for_coach", {
    p_organization_id: normalizedId,
    p_coach_id: normalizedCoachId,
  });
  if (result.error) {
    const missingFunction = result.error.code === "PGRST202"
      || result.error.message.includes("is_coach_training_assistance_enabled_for_coach");
    if (!missingFunction) throw new Error(result.error.message);

    // Keep already-running environments usable until the additive migration is applied.
    const legacyResult = await supabaseAdmin.rpc("is_coach_training_assistance_enabled", {
      p_organization_id: normalizedId,
    });
    if (legacyResult.error) throw new Error(legacyResult.error.message);
    return legacyResult.data === true;
  }
  return result.data === true;
}
