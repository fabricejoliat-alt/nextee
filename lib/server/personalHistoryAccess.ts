import type { SupabaseClient } from "@supabase/supabase-js";
import { organizationSubjectAccess } from "./organizationAccess";

/** Service-role reads need a real, authorized affiliation in the requested context. */
export async function canReadPlayerHistory(db: SupabaseClient, actorId: string, playerId: string, organizationId: string) {
  const [subjectAccess, result, roster] = await Promise.all([
    organizationSubjectAccess(db, actorId, playerId, organizationId),
    db.rpc("organization_player_authorized", { p_org: organizationId, p_player: playerId }),
    db.from("academy_roster_entries").select("status")
      .eq("academy_id", organizationId).eq("player_id", playerId).maybeSingle(),
  ]);
  if (!subjectAccess) return false;
  if (result.error) throw result.error;
  if (result.data !== true) return false;
  if (roster.error) throw roster.error;
  return !roster.data || roster.data.status === "active";
}

export async function readablePlayerHistoryIds(db: SupabaseClient, actorId: string, playerIds: string[], organizationId: string) {
  const allowed: string[] = [];
  const candidates = [...new Set(playerIds)];
  for (let index = 0; index < candidates.length; index += 10) {
    const batch = await Promise.all(candidates.slice(index, index + 10).map(async playerId =>
      await canReadPlayerHistory(db, actorId, playerId, organizationId) ? playerId : null));
    allowed.push(...batch.filter((id): id is string => id !== null));
  }
  return allowed;
}
