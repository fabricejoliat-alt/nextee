import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatisticsOrganization } from "../playerStatisticsScope";
import { canReadPlayerHistory } from "./personalHistoryAccess";
import { readRelatedRows } from "./paginatedRead";

type Membership = { organization_id: string; user_id: string };
type RosterEntry = { academy_id: string; player_id: string; status: string };

/** Statistics-only sharing between the junior's active, authorized affiliations.
 * The route must first verify that the actor manages this player in currentId.
 * This never grants access to another structure's notes, documents or messages.
 */
export async function managerStatisticsOrganizations(db: SupabaseClient, actorId: string, playerId: string, currentId: string) {
  if (!(await canReadPlayerHistory(db, actorId, playerId, currentId))) return [];
  return (await managerStatisticsOrganizationMap(db, [playerId], currentId)).get(playerId) ?? [];
}

/** playerIds must already have passed canReadPlayerHistory in the current context. */
export async function managerStatisticsOrganizationMap(db: SupabaseClient, playerIds: string[], currentId: string) {
  const result = new Map<string, StatisticsOrganization[]>();
  if (!playerIds.length) return result;
  const memberships = await readRelatedRows<Membership>(playerIds, (batch, from, to) => db.from("organization_members")
    .select("organization_id,user_id").in("user_id", batch).eq("role", "player").eq("is_active", true)
    .order("user_id").order("organization_id").range(from, to));
  const ids = [...new Set(memberships.map(row => row.organization_id))];
  if (!ids.includes(currentId)) return result;
  const [organizations, roster] = await Promise.all([
    readRelatedRows<StatisticsOrganization>(ids, (batch, from, to) => db.from("organizations").select("id,name,org_type")
      .in("id", batch).in("org_type", ["club", "academy"]).eq("is_active", true).order("id").range(from, to)),
    readRelatedRows<RosterEntry>(playerIds, (batch, from, to) => db.from("academy_roster_entries").select("academy_id,player_id,status")
      .in("player_id", batch).order("player_id").order("academy_id").range(from, to)),
  ]);
  const byId = new Map(organizations.map(row => [row.id, row]));
  const currentPlayers = new Set(memberships.filter(row => row.organization_id === currentId).map(row => row.user_id));
  const candidates = memberships.filter(row => byId.has(row.organization_id) && currentPlayers.has(row.user_id));
  for (let offset = 0; offset < candidates.length; offset += 10) {
    const allowed = await Promise.all(candidates.slice(offset, offset + 10).map(async row => {
      if (roster.some(entry => entry.player_id === row.user_id && entry.academy_id === row.organization_id && entry.status !== "active")) return null;
      const authorized = await db.rpc("organization_player_authorized", { p_org: row.organization_id, p_player: row.user_id });
      if (authorized.error) throw authorized.error;
      return authorized.data === true ? row : null;
    }));
    for (const row of allowed) if (row) result.set(row.user_id, [...(result.get(row.user_id) ?? []), byId.get(row.organization_id)!]);
  }
  for (const [playerId, available] of result) {
    // A revoked current affiliation cannot be used as a bridge to other structures.
    if (!available.some(row => row.id === currentId)) result.delete(playerId);
    else available.sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId) || a.name.localeCompare(b.name));
  }
  return result;
}
