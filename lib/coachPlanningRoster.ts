import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanningMember = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; handicap: number | null; role: string | null };
async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error("roster_load_failed");
    rows.push(...(result.data ?? []) as T[]);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}

/** No default selections may be built from truncated or partially failed lists. */
export async function loadCoachPlanningRoster(db: SupabaseClient, groupId: string, callerId: string) {
  const groupResult = await db.from("coach_groups").select("id,name,club_id,head_coach_user_id").eq("id", groupId).maybeSingle();
  if (groupResult.error || !groupResult.data) throw new Error("group_not_found");
  const group = groupResult.data as { id: string; name: string | null; club_id: string; head_coach_user_id: string | null };
  const allowed = await db.rpc("can_manage_assigned_group", { p_group_id: groupId, p_user_id: callerId, p_permission: "planning" });
  if (allowed.error || allowed.data !== true) throw new Error("forbidden");
  const [club, members, coachLinks, playerLinks] = await Promise.all([
    db.from("clubs").select("name").eq("id", group.club_id).maybeSingle(),
    allRows<{ user_id: string; role: string }>((from, to) => db.from("club_members").select("user_id,role")
      .eq("club_id", group.club_id).eq("is_active", true).order("user_id").range(from, to)),
    allRows<{ coach_user_id: string }>((from, to) => db.from("coach_group_coaches").select("coach_user_id")
      .eq("group_id", groupId).order("coach_user_id").range(from, to)),
    allRows<{ player_user_id: string }>((from, to) => db.from("coach_group_players").select("player_user_id")
      .eq("group_id", groupId).order("player_user_id").range(from, to)),
  ]);
  if (club.error) throw new Error("roster_load_failed");
  const linkedPlayerIds = new Set(playerLinks.map((row) => row.player_user_id));
  const playerIds = new Set(members.filter((row) => row.role === "player" && linkedPlayerIds.has(row.user_id)).map((row) => row.user_id));
  const coachIds = new Set([...coachLinks.map((row) => row.coach_user_id), group.head_coach_user_id]);
  const profiles = new Map<string, Omit<PlanningMember, "role">>();
  const ids = [...new Set(members.map((row) => row.user_id))];
  for (let offset = 0; offset < ids.length; offset += 150) {
    const batch = ids.slice(offset, offset + 150);
    const result = await db.from("profiles").select("id,first_name,last_name,avatar_url").in("id", batch);
    if (result.error) throw new Error("roster_load_failed");
    for (const row of result.data ?? []) profiles.set(row.id, { ...row, handicap: null });
    const juniors = batch.filter((id) => playerIds.has(id));
    if (juniors.length) {
      const handicaps = await db.from("profiles").select("id,handicap").in("id", juniors);
      if (handicaps.error) throw new Error("roster_load_failed");
      for (const row of handicaps.data ?? []) { const profile = profiles.get(row.id); if (profile) profile.handicap = row.handicap; }
    }
  }
  const roster: PlanningMember[] = members.map((row) => ({ id: row.user_id, first_name: null, last_name: null,
    avatar_url: null, handicap: null, ...profiles.get(row.user_id), role: row.role }));
  return { group, clubName: club.data?.name ?? "", members: roster,
    coaches: roster.filter((row) => coachIds.has(row.id) && ["coach", "manager"].includes(row.role ?? "")),
    players: roster.filter((row) => playerIds.has(row.id) && row.role === "player") };
}
