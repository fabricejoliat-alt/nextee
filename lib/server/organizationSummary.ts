import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrganizationAccessSummary } from "@/lib/organizationPolicy";
export async function loadOrganizationAccessSummary(db: SupabaseClient, actorId: string, playerId?: string) {
  const result = await db.rpc("organization_access_summary_checked", { p_actor: actorId, p_player: playerId ?? null });
  if (result.error) throw result.error;
  return (result.data ?? []) as OrganizationAccessSummary[];
}
