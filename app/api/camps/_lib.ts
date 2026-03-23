import { createClient } from "@supabase/supabase-js";

export const MAX_DB_EVENT_DURATION_MINUTES = 300;

export type CampCreateDayArgs = {
  campId: string;
  clubId: string;
  primaryGroupId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationText?: string | null;
  practicalInfo?: string | null;
  headCoachUserId: string;
  coachIds: string[];
  playerIds: string[];
  attendeeStatusByPlayerId?: Record<string, string>;
  callerUserId: string;
  dayIndex: number;
};

export function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function createAdminClient() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function minutesBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function isMissingTableError(error: any) {
  return String(error?.code ?? "") === "42P01";
}

export async function createCampDayEvent(supabaseAdmin: ReturnType<typeof createAdminClient>, args: CampCreateDayArgs) {
  const dayCoachIds = uniq([args.headCoachUserId, ...args.coachIds]);
  const durationMinutes = minutesBetween(args.startsAt, args.endsAt);
  if (!args.startsAt || !args.endsAt || durationMinutes <= 0) {
    return { error: `Invalid day ${args.dayIndex + 1}`, status: 400 as const };
  }

  const eventRes = await supabaseAdmin
    .from("club_events")
    .insert({
      club_id: args.clubId,
      group_id: args.primaryGroupId,
      event_type: "camp",
      title: args.title,
      starts_at: args.startsAt,
      ends_at: args.endsAt,
      duration_minutes: Math.min(durationMinutes, MAX_DB_EVENT_DURATION_MINUTES),
      location_text: args.locationText ?? null,
      coach_note: args.practicalInfo ?? null,
      status: "scheduled",
      created_by: args.callerUserId,
    })
    .select("id")
    .maybeSingle();
  if (eventRes.error || !eventRes.data?.id) {
    return { error: eventRes.error?.message ?? `Unable to create day ${args.dayIndex + 1}`, status: 400 as const };
  }

  const eventId = String(eventRes.data.id);
  const campDayRes = await supabaseAdmin.from("club_camp_days").insert({
    camp_id: args.campId,
    event_id: eventId,
    day_index: args.dayIndex,
    practical_info: args.practicalInfo ?? null,
    starts_at: args.startsAt,
    ends_at: args.endsAt,
    location_text: args.locationText ?? null,
  });
  if (campDayRes.error) return { error: campDayRes.error.message, status: 400 as const };

  if (args.playerIds.length > 0) {
    const attendeeInsert = await supabaseAdmin.from("club_event_attendees").insert(
      args.playerIds.map((playerId) => ({
        event_id: eventId,
        player_id: playerId,
        status: String(args.attendeeStatusByPlayerId?.[playerId] ?? "not_registered"),
      }))
    );
    if (attendeeInsert.error) return { error: attendeeInsert.error.message, status: 400 as const };
  }

  if (dayCoachIds.length > 0) {
    const coachInsert = await supabaseAdmin.from("club_event_coaches").insert(
      dayCoachIds.map((coachId) => ({
        event_id: eventId,
        coach_id: coachId,
      }))
    );
    if (coachInsert.error) return { error: coachInsert.error.message, status: 400 as const };
  }

  return { eventId };
}

export async function deleteClubEventDeep(supabaseAdmin: ReturnType<typeof createAdminClient>, eventId: string) {
  const deleteByEventId = async (table: string) => {
    const res = await supabaseAdmin.from(table).delete().eq("event_id", eventId);
    if (res.error && !isMissingTableError(res.error)) return res.error;
    return null;
  };

  for (const table of [
    "club_event_attendees",
    "club_event_coaches",
    "club_event_structure_items",
    "club_event_player_structure_items",
    "club_event_player_feedback",
    "club_event_coach_feedback",
  ]) {
    const error = await deleteByEventId(table);
    if (error) return { error: error.message, status: 400 as const };
  }

  const trainingSessionIdsRes = await supabaseAdmin.from("training_sessions").select("id").eq("club_event_id", eventId);
  if (trainingSessionIdsRes.error && !isMissingTableError(trainingSessionIdsRes.error)) {
    return { error: trainingSessionIdsRes.error.message, status: 400 as const };
  }

  const trainingSessionIds = (trainingSessionIdsRes.data ?? [])
    .map((row: any) => String(row.id ?? "").trim())
    .filter(Boolean);
  if (trainingSessionIds.length > 0) {
    const delSessionItemsRes = await supabaseAdmin.from("training_session_items").delete().in("session_id", trainingSessionIds);
    if (delSessionItemsRes.error && !isMissingTableError(delSessionItemsRes.error)) {
      return { error: delSessionItemsRes.error.message, status: 400 as const };
    }
  }

  const trainingSessionsRes = await supabaseAdmin.from("training_sessions").delete().eq("club_event_id", eventId);
  if (trainingSessionsRes.error && !isMissingTableError(trainingSessionsRes.error)) {
    return { error: trainingSessionsRes.error.message, status: 400 as const };
  }

  const deleteThreadsRes = await supabaseAdmin.from("message_threads").delete().eq("event_id", eventId);
  if (deleteThreadsRes.error && !isMissingTableError(deleteThreadsRes.error)) {
    return { error: deleteThreadsRes.error.message, status: 400 as const };
  }

  const delRes = await supabaseAdmin.from("club_events").delete().eq("id", eventId);
  if (delRes.error) return { error: delRes.error.message, status: 400 as const };

  return { ok: true as const };
}

export async function getCaller(supabaseAdmin: ReturnType<typeof createAdminClient>, accessToken: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return { error: "Invalid token", status: 401 as const };
  return { userId: String(data.user.id ?? "").trim() };
}

export async function assertManagerForClub(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  userId: string,
  clubId: string
) {
  const membershipRes = await supabaseAdmin
    .from("club_members")
    .select("club_id")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();
  if (membershipRes.error) return { error: membershipRes.error.message, status: 400 as const };
  if (!membershipRes.data?.club_id) return { error: "Forbidden", status: 403 as const };
  return { ok: true as const };
}

export async function resolveCoachClubIds(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  coachId: string
): Promise<{ error: string; status: 400 } | { clubIds: string[] }> {
  const [directMembershipsRes, groupCoachRes, headGroupsRes, assignedEventRes] = await Promise.all([
    supabaseAdmin.from("club_members").select("club_id").eq("user_id", coachId).eq("role", "coach").eq("is_active", true),
    supabaseAdmin.from("coach_group_coaches").select("group_id").eq("coach_user_id", coachId),
    supabaseAdmin.from("coach_groups").select("club_id").eq("head_coach_user_id", coachId),
    supabaseAdmin.from("club_event_coaches").select("event_id").eq("coach_id", coachId),
  ]);
  if (directMembershipsRes.error) return { error: directMembershipsRes.error.message, status: 400 as const };
  if (groupCoachRes.error) return { error: groupCoachRes.error.message, status: 400 as const };
  if (headGroupsRes.error) return { error: headGroupsRes.error.message, status: 400 as const };
  if (assignedEventRes.error) return { error: assignedEventRes.error.message, status: 400 as const };

  const groupIds = uniq((groupCoachRes.data ?? []).map((row: any) => row.group_id));
  const eventIds = uniq((assignedEventRes.data ?? []).map((row: any) => row.event_id));

  const [groupRes, eventRes] = await Promise.all([
    groupIds.length ? supabaseAdmin.from("coach_groups").select("club_id").in("id", groupIds) : ({ data: [], error: null } as const),
    eventIds.length ? supabaseAdmin.from("club_events").select("club_id").in("id", eventIds) : ({ data: [], error: null } as const),
  ]);
  if (groupRes.error) return { error: groupRes.error.message, status: 400 as const };
  if (eventRes.error) return { error: eventRes.error.message, status: 400 as const };

  return {
    clubIds: uniq([
      ...(directMembershipsRes.data ?? []).map((row: any) => row.club_id),
      ...(headGroupsRes.data ?? []).map((row: any) => row.club_id),
      ...(groupRes.data ?? []).map((row: any) => row.club_id),
      ...(eventRes.data ?? []).map((row: any) => row.club_id),
    ]),
  };
}

export async function resolvePlayerAccess(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  accessToken: string,
  childIdRaw: string,
  mode: "view" | "edit" = "view"
): Promise<
  | { error: string; status: 401 | 400 | 403 }
  | { viewerUserId: string; effectiveUserId: string; isParent: boolean; clubIds: string[] }
> {
  const caller = await getCaller(supabaseAdmin, accessToken);
  if ("error" in caller) return { error: caller.error, status: caller.status };

  const viewerUserId = caller.userId;
  const childId = String(childIdRaw ?? "").trim();
  const membershipsRes = await supabaseAdmin
    .from("club_members")
    .select("role")
    .eq("user_id", viewerUserId)
    .eq("is_active", true);
  if (membershipsRes.error) return { error: membershipsRes.error.message, status: 400 as const };

  const roles = new Set(((membershipsRes.data ?? []) as Array<{ role: string | null }>).map((row) => String(row.role ?? "")));
  const isParent = roles.has("parent");

  let effectiveUserId = viewerUserId;
  if (isParent && childId) {
    const guardianRes = await supabaseAdmin
      .from("player_guardians")
      .select("player_id")
      .eq("guardian_user_id", viewerUserId)
      .eq("player_id", childId)
      .or(mode === "edit" ? "can_edit.eq.true" : "can_view.is.null,can_view.eq.true")
      .maybeSingle();
    if (guardianRes.error) return { error: guardianRes.error.message, status: 400 as const };
    if (!guardianRes.data?.player_id) return { error: "Forbidden", status: 403 as const };
    effectiveUserId = String(guardianRes.data.player_id ?? "").trim();
  } else if (isParent) {
    const childRes = await supabaseAdmin
      .from("player_guardians")
      .select("player_id,is_primary")
      .eq("guardian_user_id", viewerUserId)
      .or(mode === "edit" ? "can_edit.eq.true" : "can_view.is.null,can_view.eq.true")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (childRes.error) return { error: childRes.error.message, status: 400 as const };
    const fallback = String(childRes.data?.[0]?.player_id ?? "").trim();
    if (!fallback) return { error: "Forbidden", status: 403 as const };
    effectiveUserId = fallback;
  }

  const membershipsByClubRes = await supabaseAdmin
    .from("club_members")
    .select("club_id")
    .eq("user_id", effectiveUserId)
    .eq("is_active", true);
  if (membershipsByClubRes.error) return { error: membershipsByClubRes.error.message, status: 400 as const };

  return {
    viewerUserId,
    effectiveUserId,
    isParent,
    clubIds: uniq((membershipsByClubRes.data ?? []).map((row: any) => row.club_id)),
  };
}
