import type { SupabaseClient } from "@supabase/supabase-js";

export async function activeCoachMemberships(db: SupabaseClient, userId: string) {
  const result = await db.from("club_members").select("club_id,role")
    .eq("user_id", userId).eq("is_active", true).in("role", ["coach", "manager"]);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as Array<{ club_id: string; role: "coach" | "manager" }>;
}

/** Historical assignments never confer access without a current staff membership. */
export async function resolveCoachAssignments(db: SupabaseClient, userId: string) {
  const memberships = await activeCoachMemberships(db, userId);
  const clubIds = [...new Set(memberships.map((row) => row.club_id))];
  if (!clubIds.length) return { memberships, clubIds, groups: [], eventIds: [] as string[] };

  const [head, links, assigned] = await Promise.all([
    db.from("coach_groups").select("id,club_id").in("club_id", clubIds).eq("head_coach_user_id", userId),
    db.from("coach_group_coaches").select("group_id").eq("coach_user_id", userId),
    db.from("club_event_coaches").select("event_id").eq("coach_id", userId),
  ]);
  for (const result of [head, links, assigned]) if (result.error) throw new Error(result.error.message);
  const linkedIds = (links.data ?? []).map((row) => String(row.group_id));
  const assignedIds = (assigned.data ?? []).map((row) => String(row.event_id));
  const [linkedGroups, assignedEvents] = await Promise.all([
    linkedIds.length
      ? db.from("coach_groups").select("id,club_id").in("id", linkedIds).in("club_id", clubIds)
      : Promise.resolve({ data: [], error: null }),
    assignedIds.length
      ? db.from("club_events").select("id").in("id", assignedIds).in("club_id", clubIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [linkedGroups, assignedEvents]) if (result.error) throw new Error(result.error.message);
  const groups = [...new Map(
    [...(head.data ?? []), ...(linkedGroups.data ?? [])].map((row) => [String(row.id), { id: String(row.id), club_id: String(row.club_id) }])
  ).values()];
  return { memberships, clubIds, groups, eventIds: (assignedEvents.data ?? []).map((row) => String(row.id)) };
}

export async function canCoachAccessEvent(
  db: SupabaseClient, callerId: string, eventId: string, groupId: string | null, clubId: string
) {
  if (!clubId) return false;
  const memberships = await activeCoachMemberships(db, callerId);
  const clubMemberships = memberships.filter((row) => row.club_id === clubId);
  if (!clubMemberships.length) return false;
  if (clubMemberships.some((row) => row.role === "manager")) return true;
  const [group, link, assigned] = await Promise.all([
    groupId ? db.from("coach_groups").select("id,head_coach_user_id").eq("id", groupId).eq("club_id", clubId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    groupId ? db.from("coach_group_coaches").select("group_id").eq("group_id", groupId).eq("coach_user_id", callerId).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("club_event_coaches").select("event_id").eq("event_id", eventId).eq("coach_id", callerId).limit(1).maybeSingle(),
  ]);
  for (const result of [group, link, assigned]) if (result.error) throw new Error(result.error.message);
  return Boolean(assigned.data || (group.data && (group.data.head_coach_user_id === callerId || link.data)));
}

export async function requireCoachEventPlayer(db: SupabaseClient, eventId: string, playerId: string) {
  const attendee = await db.from("club_event_attendees").select("player_id")
    .eq("event_id", eventId).eq("player_id", playerId).maybeSingle();
  if (attendee.error) throw new Error(attendee.error.message);
  if (!attendee.data) throw new Error("unknown_attendee");
}
