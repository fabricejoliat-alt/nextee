import type { SupabaseClient } from "@supabase/supabase-js";
import { canCoachAccessEvent, resolveCoachAssignments } from "@/lib/coachAccess";

type CoachPlayerAccessResult = {
  sharedClubIds: string[];
  sensitiveClubIds: string[];
  isManagerForSharedClub: boolean;
  canAccessSensitiveSections: boolean;
  sharedGroupIds: string[];
  sharedEventIds: string[];
};

type CampCoachPlayerAccessResult = { allowed: boolean; clubId: string | null };

export async function resolveCoachPlayerAccess(
  supabaseAdmin: SupabaseClient, callerId: string, playerId: string
): Promise<CoachPlayerAccessResult> {
  const [scope, playerRes] = await Promise.all([
    resolveCoachAssignments(supabaseAdmin, callerId),
    supabaseAdmin.from("club_members").select("club_id")
      .eq("user_id", playerId).eq("role", "player").eq("is_active", true),
  ]);
  if (playerRes.error) throw new Error(playerRes.error.message);
  const playerClubIds = new Set((playerRes.data ?? []).map((row) => String(row.club_id)));
  const sharedClubIds = scope.clubIds.filter((id) => playerClubIds.has(id));
  const empty = { sharedClubIds, sensitiveClubIds: [], isManagerForSharedClub: false,
    canAccessSensitiveSections: false, sharedGroupIds: [], sharedEventIds: [] };
  if (!sharedClubIds.length) return empty;

  const managerClubIds = scope.memberships
    .filter((row) => row.role === "manager" && sharedClubIds.includes(row.club_id))
    .map((row) => row.club_id);
  const assignedGroupIds = scope.groups.filter((row) => sharedClubIds.includes(row.club_id)).map((row) => row.id);
  const groupRes = assignedGroupIds.length
    ? await supabaseAdmin.from("coach_groups").select("id,club_id").in("id", assignedGroupIds).eq("is_active", true)
    : { data: [], error: null };
  if (groupRes.error) throw new Error(groupRes.error.message);
  const groups = groupRes.data ?? [];
  const activeGroupIds = groups.map((row) => String(row.id));
  const [playerGroups, playerEvents] = await Promise.all([
    activeGroupIds.length
      ? supabaseAdmin.from("coach_group_players").select("group_id").eq("player_user_id", playerId).in("group_id", activeGroupIds)
      : Promise.resolve({ data: [], error: null }),
    scope.eventIds.length
      ? supabaseAdmin.from("club_event_attendees").select("event_id").eq("player_id", playerId).in("event_id", scope.eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [playerGroups, playerEvents]) if (result.error) throw new Error(result.error.message);
  const sharedGroupIds = [...new Set((playerGroups.data ?? []).map((row) => String(row.group_id)))];
  // A relationship in club A must never unlock club B's private material.
  const sensitiveClubIds = [...new Set([
    ...managerClubIds,
    ...groups.filter((row) => sharedGroupIds.includes(String(row.id))).map((row) => String(row.club_id)),
  ])];
  return {
    sharedClubIds, sensitiveClubIds,
    isManagerForSharedClub: managerClubIds.length > 0,
    canAccessSensitiveSections: sensitiveClubIds.length > 0,
    sharedGroupIds,
    sharedEventIds: [...new Set((playerEvents.data ?? []).map((row) => String(row.event_id)))],
  };
}

export async function resolveCampCoachPlayerAccess(
  supabaseAdmin: SupabaseClient,
  callerId: string,
  playerId: string,
  clubEventId: string
): Promise<CampCoachPlayerAccessResult> {
  const normalizedEventId = String(clubEventId ?? "").trim();
  if (!normalizedEventId) {
    return { allowed: false, clubId: null };
  }

  const eventRes = await supabaseAdmin
    .from("club_events")
    .select("id,club_id,group_id,event_type")
    .eq("id", normalizedEventId)
    .maybeSingle();
  if (eventRes.error) throw new Error(eventRes.error.message);

  const event = eventRes.data as { id?: string | null; club_id?: string | null; group_id?: string | null; event_type?: string | null } | null;
  const clubId = String(event?.club_id ?? "").trim() || null;
  if (!event?.id || event?.event_type !== "camp" || !clubId) {
    return { allowed: false, clubId };
  }
  if (!(await canCoachAccessEvent(supabaseAdmin, callerId, normalizedEventId, event.group_id ?? null, clubId))) {
    return { allowed: false, clubId };
  }

  const dayRes = await supabaseAdmin.from("club_camp_days").select("camp_id")
    .eq("event_id", normalizedEventId).maybeSingle();
  if (dayRes.error) throw new Error(dayRes.error.message);

  const campId = String((dayRes.data as { camp_id?: string | null } | null)?.camp_id ?? "").trim();
  if (!campId) {
    return { allowed: false, clubId };
  }

  const registrationRes = await supabaseAdmin
    .from("club_camp_players")
    .select("player_id")
    .eq("camp_id", campId)
    .eq("player_id", playerId)
    .eq("registration_status", "registered")
    .maybeSingle();
  if (registrationRes.error) throw new Error(registrationRes.error.message);

  return {
    allowed: Boolean(registrationRes.data),
    clubId,
  };
}
