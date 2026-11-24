import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatisticsOrganization } from "../playerStatisticsScope";
import { readRelatedRows } from "./paginatedRead";

type Membership = { organization_id: string; user_id: string };
type RosterEntry = { academy_id: string; player_id: string; status: string };

/** Statistics for the manager's own roster and the junior's authorized affiliations.
 * The route must first verify that the actor manages this player in currentId.
 * This never grants access to another structure's notes, documents or messages.
 */
export async function managerStatisticsOrganizations(db: SupabaseClient, playerId: string, currentId: string) {
  return (await managerStatisticsOrganizationMap(db, [playerId], currentId)).get(playerId) ?? [];
}

/** Caller must be an authenticated manager of currentId (or platform admin).
 * Manager statistics cover every retained player membership, independently of
 * Player/Parent onboarding. Other affiliations still require active authorization.
 */
export async function managerStatisticsOrganizationMap(db: SupabaseClient, playerIds: string[], currentId: string) {
  const result = new Map<string, StatisticsOrganization[]>();
  if (!playerIds.length) return result;
  const currentMembers = await readRelatedRows<{ user_id: string }>(playerIds, (batch, from, to) => db.from("club_members")
    .select("user_id").eq("club_id", currentId).eq("role", "player").in("user_id", batch).order("user_id").range(from, to));
  const currentPlayers = new Set(currentMembers.map(row => row.user_id));
  if (!currentPlayers.size) return result;
  const memberships = await readRelatedRows<Membership>([...currentPlayers], (batch, from, to) => db.from("organization_members")
    .select("organization_id,user_id").in("user_id", batch).eq("role", "player").eq("is_active", true)
    .order("user_id").order("organization_id").range(from, to));
  const ids = [...new Set([currentId, ...memberships.map(row => row.organization_id)])];
  const [organizations, roster] = await Promise.all([
    readRelatedRows<StatisticsOrganization>(ids, (batch, from, to) => db.from("organizations").select("id,name,org_type")
      .in("id", batch).in("org_type", ["club", "academy"]).eq("is_active", true).order("id").range(from, to)),
    readRelatedRows<RosterEntry>(playerIds, (batch, from, to) => db.from("academy_roster_entries").select("academy_id,player_id,status")
      .in("player_id", batch).order("player_id").order("academy_id").range(from, to)),
  ]);
  const byId = new Map(organizations.map(row => [row.id, row]));
  const currentOrganization = byId.get(currentId);
  if (!currentOrganization) return result;
  for (const playerId of currentPlayers) result.set(playerId, [currentOrganization]);
  const candidates = memberships.filter(row => row.organization_id !== currentId && byId.has(row.organization_id) && currentPlayers.has(row.user_id));
  for (let offset = 0; offset < candidates.length; offset += 10) {
    const allowed = await Promise.all(candidates.slice(offset, offset + 10).map(async row => {
      if (roster.some(entry => entry.player_id === row.user_id && entry.academy_id === row.organization_id && entry.status !== "active")) return null;
      const authorized = await db.rpc("organization_player_authorized", { p_org: row.organization_id, p_player: row.user_id });
      if (authorized.error) throw authorized.error;
      return authorized.data === true ? row : null;
    }));
    for (const row of allowed) if (row) result.set(row.user_id, [...(result.get(row.user_id) ?? []), byId.get(row.organization_id)!]);
  }
  for (const available of result.values()) {
    available.sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId) || a.name.localeCompare(b.name));
  }
  return result;
}
