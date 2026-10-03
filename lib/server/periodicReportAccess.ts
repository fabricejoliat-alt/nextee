import type { SupabaseClient } from "@supabase/supabase-js";

/** Check current rights, never the historical recipient snapshot in a config. */
export async function authorizedReportRecipients(db: SupabaseClient, clubId: string, playerId: string, candidates: string[]) {
  if (!candidates.length) return [];
  const [player, parents, links] = await Promise.all([
    db.from("club_members").select("id,player_consent_status").eq("club_id", clubId)
      .eq("user_id", playerId).eq("role", "player").eq("is_active", true).maybeSingle(),
    db.from("club_members").select("user_id").eq("club_id", clubId).eq("role", "parent")
      .eq("is_active", true).in("user_id", candidates),
    db.from("player_guardians").select("guardian_user_id,can_view").eq("player_id", playerId)
      .in("guardian_user_id", candidates),
  ]);
  for (const result of [player, parents, links]) if (result.error) throw new Error(result.error.message);
  if (!player.data || !["granted", "adult"].includes(player.data.player_consent_status)) return [];
  const activeParents = new Set((parents.data ?? []).map((row) => row.user_id));
  const allowed = new Set((links.data ?? []).filter((row) => row.can_view === true && activeParents.has(row.guardian_user_id))
    .map((row) => row.guardian_user_id));
  return [...new Set(candidates)].filter((id) => allowed.has(id));
}
