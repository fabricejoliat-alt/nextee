import type { SupabaseClient } from "@supabase/supabase-js";

/** Delivery checks current organization rights, never a historical recipient list. */
export async function authorizedReportRecipients(db: SupabaseClient, organizationId: string, playerId: string, candidates: string[]) {
  if (!candidates.length) return [];
  const scopes = await db.from("player_guardian_scopes").select("guardian_user_id")
    .eq("organization_id", organizationId).eq("player_id", playerId).eq("status", "active")
    .eq("can_view", true).in("guardian_user_id", [...new Set(candidates)]);
  if (scopes.error) throw scopes.error;
  const results = await Promise.all((scopes.data ?? []).map(async row => {
    const [access, legal] = await Promise.all([
      db.rpc("organization_actor_access", { p_org: organizationId, p_actor: row.guardian_user_id, p_player: playerId }),
      db.rpc("organization_actor_legal_ready", { p_org: organizationId, p_actor: row.guardian_user_id }),
    ]);
    if (access.error || legal.error) throw access.error ?? legal.error;
    return access.data === true && legal.data === true ? row.guardian_user_id : null;
  }));
  return results.filter((id): id is string => id !== null);
}
