import type { SupabaseClient } from "@supabase/supabase-js";

export async function isCoachTrainingAssistanceEnabled(
  supabaseAdmin: SupabaseClient,
  organizationId: string
) {
  const normalizedId = String(organizationId ?? "").trim();
  if (!normalizedId) return false;

  const result = await supabaseAdmin.rpc("is_coach_training_assistance_enabled", {
    p_organization_id: normalizedId,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data === true;
}
