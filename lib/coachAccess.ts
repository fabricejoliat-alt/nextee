import type { SupabaseClient } from "@supabase/supabase-js";

export async function activeCoachMemberships(db: SupabaseClient, userId: string) {
  const result = await db.from("club_members").select("club_id,role")
    .eq("user_id", userId).eq("is_active", true).in("role", ["coach", "manager"]);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as Array<{ club_id: string; role: "coach" | "manager" }>;
}

/** Historical assignments never confer access without a current staff membership. */
export async function resolveCoachAssignments(db: SupabaseClient, userId: string, organizationId?: string | null) {
  const candidates = (await activeCoachMemberships(db, userId)).filter(row=>!organizationId||row.club_id===organizationId);
  const readiness = await Promise.all(candidates.map(async row => {
    const result=await db.rpc("organization_actor_legal_ready",{p_org:row.club_id,p_actor:userId});
    if(result.error)throw result.error;return result.data===true?row:null;
  }));
  const memberships=readiness.filter((row):row is NonNullable<typeof row>=>row!==null);
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
  const ready=await db.rpc("organization_actor_legal_ready",{p_org:clubId,p_actor:callerId});
  if(ready.error)throw ready.error;if(ready.data!==true)return false;
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

export async function requireCoachEventPlayer(db: SupabaseClient, eventId: string, playerId: string, actorId: string, organizationId: string) {
  const event = await db.from("club_events").select("club_id").eq("id", eventId).maybeSingle();
  if (event.error) throw event.error;
  if (event.data?.club_id !== organizationId) throw new Error("forbidden");
  const access = await db.rpc("organization_event_player_access", { p_actor: actorId, p_event: eventId, p_player: playerId });
  if (access.error) throw access.error;
  if (access.data !== true) throw new Error("forbidden");
  const attendee = await db.from("club_event_attendees").select("player_id")
    .eq("event_id", eventId).eq("player_id", playerId).maybeSingle();
  if (attendee.error) throw new Error(attendee.error.message);
  if (!attendee.data) throw new Error("unknown_attendee");
}

export async function authorizedCoachPlayers(db: SupabaseClient, actorId: string, organizationId: string, ids: string[], eventId?: string) {
  const results=await Promise.all([...new Set(ids)].map(async playerId=>{
    const access=eventId
      ? await db.rpc("organization_event_player_access",{p_actor:actorId,p_event:eventId,p_player:playerId})
      : await db.rpc("organization_actor_access",{p_org:organizationId,p_actor:actorId,p_player:playerId});
    if(access.error)throw access.error;return access.data===true?playerId:null;
  }));return new Set(results.filter((id):id is string=>id!==null));
}
