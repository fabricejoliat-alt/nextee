import type { SupabaseClient } from "@supabase/supabase-js";
import { coachRosterPlayerIds } from "@/lib/server/coachRoster";
import { authorizedCoachPlayers } from "@/lib/coachAccess";
import { coachRows } from "@/lib/server/coachRows";

export type DirectoryGroup = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null };
type Membership = { club_id: string; user_id: string; role: string; can_transfer_players_between_club_groups?: boolean };
type GroupLink = { group_id: string; coach_user_id: string; is_head: boolean };
type RosterRow = { group_id: string; player_user_id: string };
type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; handicap: number | null; sex: string | null };

function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error("directory_load_failed");
  return result.data!;
}

/** Service-role projection: validate current membership, organization, legal
 * readiness and each junior's access before returning any directory data.
 * No per-row browser/RLS fan-out, persistent cache or private fields. */
export async function loadCoachDirectory(db: SupabaseClient, actorId: string, view: "groups" | "players", organizationId: string | null) {
  const candidates = await coachRows<Membership>((from, to) => db.from("club_members")
    .select("club_id,user_id,role,can_transfer_players_between_club_groups")
    .eq("user_id", actorId).eq("role", "coach").eq("is_active", true).order("club_id").range(from, to));
  const scoped = candidates.filter((row) => !organizationId || row.club_id === organizationId);
  const memberships = (await Promise.all(scoped.map(async (row) => {
    const [access, legal] = await Promise.all([
      db.rpc("organization_actor_access", { p_org: row.club_id, p_actor: actorId }),
      db.rpc("organization_actor_legal_ready", { p_org: row.club_id, p_actor: actorId }),
    ]);
    return checked(access) === true && checked(legal) === true ? row : null;
  }))).filter((row): row is Membership => row !== null);
  const clubIds = [...new Set(memberships.map((row) => row.club_id))];
  const empty = { groups: [], players: [], clubs: [] };
  if (!clubIds.length) return empty;
  const transferClubs = new Set(memberships.filter((row) => row.can_transfer_players_between_club_groups).map((row) => row.club_id));
  const [allGroups, clubs] = await Promise.all([
    coachRows<DirectoryGroup>((from, to) => {
      let query = db.from("coach_groups").select("id,club_id,name,is_active,head_coach_user_id").in("club_id", clubIds);
      if (view === "groups") query = query.eq("is_active", true);
      return query.order("id").range(from, to);
    }),
    coachRows<{ id: string; name: string | null }>((from, to) => db.from("organizations").select("id,name")
      .in("id", clubIds).order("id").range(from, to)),
  ]);
  const candidateGroupIds = allGroups.map((row) => row.id);
  const links = candidateGroupIds.length ? await coachRows<GroupLink>((from, to) => db.from("coach_group_coaches")
    .select("group_id,coach_user_id,is_head").in("group_id", candidateGroupIds).order("group_id").order("coach_user_id").range(from, to)) : [];
  const assignedIds = new Set([
    ...allGroups.filter((row) => row.head_coach_user_id === actorId).map((row) => row.id),
    ...links.filter((row) => row.coach_user_id === actorId).map((row) => row.group_id),
  ]);
  const groups = allGroups.filter((row) => {
    const name = row.name.trim();
    return row.is_active && name !== "Groupe spécifique" && !name.startsWith("__EVENT_SPECIFIQUE__") && !name.startsWith("__ARCHIVE_DELETED__")
      && (assignedIds.has(row.id) || transferClubs.has(row.club_id));
  });
  // Junior visibility retains assignments in inactive/historical groups, as the
  // former junior directory did; the group directory only lists active groups.
  const rosterGroupIds = view === "groups" ? groups.map((row) => row.id)
    : allGroups.filter((row) => assignedIds.has(row.id) || transferClubs.has(row.club_id)).map((row) => row.id);
  const roster = rosterGroupIds.length ? await coachRows<RosterRow>((from, to) => db.from("coach_group_players")
    .select("group_id,player_user_id").in("group_id", rosterGroupIds).order("group_id").order("player_user_id").range(from, to)) : [];
  const groupClubs = new Map(allGroups.map((row) => [row.id, row.club_id]));
  const assignedPlayers = new Set(roster.filter((row) => assignedIds.has(row.group_id)).map((row) => `${groupClubs.get(row.group_id)}:${row.player_user_id}`));
  const members = await coachRows<Membership>((from, to) => db.from("club_members").select("club_id,user_id,role")
    .in("club_id", clubIds).eq("role", "player").eq("is_active", true).order("club_id").order("user_id").range(from, to));
  const visibleMembers = (await Promise.all(clubIds.map(async (clubId) => {
    const candidates = members.filter((row) => row.club_id === clubId && (assignedPlayers.has(`${clubId}:${row.user_id}`) || transferClubs.has(clubId)));
    const allowed = await coachRosterPlayerIds(db, actorId, clubId, candidates.map((row) => row.user_id));
    return candidates.filter((row) => allowed.has(row.user_id));
  }))).flat();
  const allowedInClub = new Set(visibleMembers.map((row) => `${row.club_id}:${row.user_id}`));
  const clubNames = new Map(clubs.map((row) => [row.id, row.name ?? ""]));
  if (view === "groups") {
    const ids = groups.map((row) => row.id);
    const categories = ids.length ? await coachRows<{ group_id: string; category: string }>((from, to) => db.from("coach_group_categories")
      .select("group_id,category").in("group_id", ids).order("group_id").order("category").range(from, to)) : [];
    const staff = await coachRows<Membership>((from, to) => db.from("club_members").select("club_id,user_id,role")
      .in("club_id", clubIds).in("role", ["coach", "manager"]).eq("is_active", true).order("club_id").order("user_id").range(from, to));
    const activeStaff = new Set(staff.map((row) => `${row.club_id}:${row.user_id}`));
    const coachIds = (group: DirectoryGroup) => [...new Set([
      ...links.filter((row) => row.group_id === group.id).map((row) => row.coach_user_id),
      ...(group.head_coach_user_id ? [group.head_coach_user_id] : []),
    ])].filter((id) => activeStaff.has(`${group.club_id}:${id}`));
    const visibleIds = [...new Set([...visibleMembers.map((row) => row.user_id), ...groups.flatMap(coachIds)])];
    const people = visibleIds.length ? await coachRows<Profile>((from, to) => db.from("profiles")
      .select("id,first_name,last_name,avatar_url").in("id", visibleIds).order("id").range(from, to)) : [];
    const identities = new Map(people.map((row) => [row.id, { id: row.id, first_name: row.first_name, last_name: row.last_name, avatar_url: row.avatar_url }]));
    const person = (id: string) => identities.get(id) ?? { id, first_name: null, last_name: null, avatar_url: null };
    return { clubs, players: [], groups: groups.map((group) => ({ ...group, clubName: clubNames.get(group.club_id) ?? "",
      isAssigned: assignedIds.has(group.id), isHead: group.head_coach_user_id === actorId || links.some((row) => row.group_id === group.id && row.coach_user_id === actorId && row.is_head),
      playerCount: roster.filter((row) => row.group_id === group.id && allowedInClub.has(`${group.club_id}:${row.player_user_id}`)).length,
      coachCount: coachIds(group).length,
      players: [...new Set(roster.filter((row) => row.group_id === group.id && allowedInClub.has(`${group.club_id}:${row.player_user_id}`)).map((row) => row.player_user_id))].map(person),
      coaches: coachIds(group).map(person),
      categories: categories.filter((row) => row.group_id === group.id).map((row) => row.category),
    })) };
  }
  const detailAccess = new Set((await Promise.all(clubIds.map(async (clubId) => {
    const ids = visibleMembers.filter((row) => row.club_id === clubId).map((row) => row.user_id);
    return [...await authorizedCoachPlayers(db, actorId, clubId, ids)];
  }))).flat());
  const playerIds = [...new Set(visibleMembers.map((row) => row.user_id))];
  const profiles = playerIds.length ? await coachRows<Profile>((from, to) => db.from("profiles")
    .select("id,first_name,last_name,avatar_url,handicap,sex").in("id", playerIds).order("id").range(from, to)) : [];
  return { clubs, groups: [], players: profiles.map((profile) => {
    const ids = [...new Set(visibleMembers.filter((row) => row.user_id === profile.id).map((row) => row.club_id))];
    return { id: profile.id, first_name: profile.first_name, last_name: profile.last_name,
      avatar_url: profile.avatar_url, handicap: detailAccess.has(profile.id) ? profile.handicap : null, sex: profile.sex,
      can_access_details: detailAccess.has(profile.id),
      club_ids: ids, club_names: ids.map((id) => clubNames.get(id) ?? "") };
  }) };
}
