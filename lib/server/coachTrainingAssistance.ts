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

    // Missing per-coach policy must never fall back to a club-wide opt-in.
    // Manual evaluation remains available while assistance fails closed.
    return false;
  }
  return result.data === true;
}
