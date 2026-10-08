import type { SupabaseClient } from "@supabase/supabase-js";

/** Family metadata is shared; permissions and roster belong to this organization. */
export async function organizationGuardians(db: SupabaseClient, organizationId: string, playerIds?: string[], onboarding = true) {
  let request = db.from("player_guardian_scopes")
    .select("player_id,guardian_user_id,can_view,can_edit,identity:player_guardians(relation,is_primary)")
    .eq("organization_id", organizationId).in("status", onboarding ? ["pending", "active"] : ["active"])
    .eq("can_view", true);
  if (playerIds) {
    if (!playerIds.length) return { data: [], error: null };
    request = request.in("player_id", playerIds);
  }
  const response = await request;
  return { error: response.error, data: (response.data ?? []).map(row => {
    const identity = Array.isArray(row.identity) ? row.identity[0] : row.identity;
    return { player_id: row.player_id, guardian_user_id: row.guardian_user_id, can_view: row.can_view,
      can_edit: row.can_edit, relation: identity?.relation ?? "other", is_primary: identity?.is_primary ?? false };
  }) };
}
