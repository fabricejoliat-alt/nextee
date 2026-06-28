import { NextRequest, NextResponse } from "next/server";
import {
  assertManagerForClub,
  createAdminClient,
  createCampDayEvent,
  getCaller,
  localDateTimeInputToIso,
  normalizeText,
  uniq,
} from "@/app/api/camps/_lib";

export type CampCreateDayInput = {
  event_id?: string | null;
  starts_at: string;
  ends_at: string;
  location_text?: string | null;
  practical_info?: string | null;
  coach_ids?: string[];
};

type CampPlayerRegistrationInput = {
  player_id?: string | null;
  registration_status?: string | null;
  day_status_by_day_index?: Record<string, string | null | undefined> | null;
};

const VALID_CAMP_REGISTRATION_STATUSES = new Set(["invited", "registered", "declined"]);
const VALID_CAMP_DAY_STATUSES = new Set(["present", "absent"]);

function uniqIds(values: unknown) {
  return uniq(Array.isArray(values) ? values.map((value) => String(value ?? "").trim()) : []);
}

function normalizeRegistrationStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_CAMP_REGISTRATION_STATUSES.has(normalized) ? normalized : "invited";
}

function normalizeDayStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_CAMP_DAY_STATUSES.has(normalized) ? normalized : "present";
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const clubIdsRes = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", caller.userId)
      .eq("role", "manager")
      .eq("is_active", true);
    if (clubIdsRes.error) return NextResponse.json({ error: clubIdsRes.error.message }, { status: 400 });

    const managedClubIds = uniq((clubIdsRes.data ?? []).map((row: any) => row.club_id));
    if (managedClubIds.length === 0) return NextResponse.json({ camps: [] });

    const campsRes = await supabaseAdmin
      .from("club_camps")
      .select("id,club_id,title,notes,status,head_coach_user_id,created_at")
      .in("club_id", managedClubIds)
      .order("created_at", { ascending: false });
    if (campsRes.error) return NextResponse.json({ error: campsRes.error.message }, { status: 400 });

    const camps = campsRes.data ?? [];
    const campIds = uniq(camps.map((camp: any) => camp.id));
    const clubIds = uniq(camps.map((camp: any) => camp.club_id));
    const headCoachIds = uniq(camps.map((camp: any) => camp.head_coach_user_id));

    const [daysRes, campPlayersRes, clubRes, profileRes, clubPlayerMembershipsRes] = await Promise.all([
      campIds.length
        ? supabaseAdmin
            .from("club_camp_days")
            .select("camp_id,event_id,day_index,practical_info,starts_at,ends_at,location_text,club_events:event_id(id,status,group_id)")
            .in("camp_id", campIds)
            .order("day_index", { ascending: true })
        : ({ data: [], error: null } as const),
      campIds.length
        ? supabaseAdmin
            .from("club_camp_players")
            .select("camp_id,player_id,registration_status")
            .in("camp_id", campIds)
        : ({ data: [], error: null } as const),
      clubIds.length ? supabaseAdmin.from("clubs").select("id,name").in("id", clubIds) : ({ data: [], error: null } as const),
      headCoachIds.length
        ? supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", headCoachIds)
        : ({ data: [], error: null } as const),
      clubIds.length
        ? supabaseAdmin
            .from("club_members")
            .select("club_id,user_id")
            .in("club_id", clubIds)
            .eq("role", "player")
            .eq("is_active", true)
        : ({ data: [], error: null } as const),
    ]);
    if (daysRes.error) return NextResponse.json({ error: daysRes.error.message }, { status: 400 });
    if (campPlayersRes.error) return NextResponse.json({ error: campPlayersRes.error.message }, { status: 400 });
    if (clubRes.error) return NextResponse.json({ error: clubRes.error.message }, { status: 400 });
    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });
    if (clubPlayerMembershipsRes.error) return NextResponse.json({ error: clubPlayerMembershipsRes.error.message }, { status: 400 });

    const clubNameById = new Map<string, string>();
    (clubRes.data ?? []).forEach((club: any) => clubNameById.set(String(club.id), String(club.name ?? "Club")));
    const headCoachById = new Map<string, any>();
    (profileRes.data ?? []).forEach((profile: any) => headCoachById.set(String(profile.id), profile));

    const daysByCampId: Record<string, any[]> = {};
    const dayIndexByEventId: Record<string, number> = {};
    const playerRegistrationsByCampId: Record<
      string,
      Array<{
        player_id: string;
        registration_status: string;
        day_status_by_day_index: Record<string, string>;
        player: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null } | null;
      }>
    > = {};
    const playerRegistrationByCampAndPlayer: Record<
      string,
      Record<
        string,
        {
          player_id: string;
          registration_status: string;
          day_status_by_day_index: Record<string, string>;
          player: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null } | null;
        }
      >
    > = {};
    (daysRes.data ?? []).forEach((row: any) => {
      const campId = String(row.camp_id ?? "").trim();
      const eventId = String(row.event_id ?? "").trim();
      if (!campId) return;
      if (eventId) {
        dayIndexByEventId[eventId] = Number(row.day_index ?? 0);
      }
      if (!daysByCampId[campId]) daysByCampId[campId] = [];
      daysByCampId[campId].push({
        event_id: eventId,
        day_index: Number(row.day_index ?? 0),
        practical_info: row.practical_info ?? null,
        starts_at: row.starts_at ?? null,
        ends_at: row.ends_at ?? null,
        location_text: row.location_text ?? null,
        status: row.club_events?.status ?? "scheduled",
        group_id: String(row.club_events?.group_id ?? ""),
        counts: { present: 0, not_registered: 0, absent: 0, excused: 0 },
        participants_count: 0,
        participants: [] as Array<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>,
      });
    });

    const campPlayerIds = uniq((campPlayersRes.data ?? []).map((row: any) => String(row.player_id ?? "").trim()));
    const clubPlayerIds = uniq((clubPlayerMembershipsRes.data ?? []).map((row: any) => String(row.user_id ?? "").trim()));
    const profileIdsToLoad = uniq([...campPlayerIds, ...clubPlayerIds]);
    const campPlayerProfilesRes = profileIdsToLoad.length
      ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", profileIdsToLoad)
      : ({ data: [], error: null } as const);
    if (campPlayerProfilesRes.error) return NextResponse.json({ error: campPlayerProfilesRes.error.message }, { status: 400 });

    const campPlayerProfileById = new Map<string, any>();
    (campPlayerProfilesRes.data ?? []).forEach((profile: any) => {
      campPlayerProfileById.set(String(profile.id ?? "").trim(), profile);
    });
    (campPlayersRes.data ?? []).forEach((row: any) => {
      const campId = String(row.camp_id ?? "").trim();
      const playerId = String(row.player_id ?? "").trim();
      if (!campId || !playerId) return;
      if (!playerRegistrationsByCampId[campId]) playerRegistrationsByCampId[campId] = [];
      if (!playerRegistrationByCampAndPlayer[campId]) playerRegistrationByCampAndPlayer[campId] = {};
      const profile = campPlayerProfileById.get(playerId) ?? null;
      const normalizedRegistrationStatus = normalizeRegistrationStatus(row.registration_status);
      const registration = {
        player_id: playerId,
        registration_status: normalizedRegistrationStatus,
        day_status_by_day_index: {} as Record<string, string>,
        player: profile
          ? {
              id: playerId,
              first_name: profile.first_name ?? null,
              last_name: profile.last_name ?? null,
              avatar_url: profile.avatar_url ?? null,
            }
          : null,
      };
      playerRegistrationsByCampId[campId].push(registration);
      playerRegistrationByCampAndPlayer[campId][playerId] = registration;
    });

    const availablePlayersByClubId: Record<string, Array<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>> = {};
    (clubPlayerMembershipsRes.data ?? []).forEach((row: any) => {
      const clubId = String(row.club_id ?? "").trim();
      const playerId = String(row.user_id ?? "").trim();
      if (!clubId || !playerId) return;
      const profile = campPlayerProfileById.get(playerId);
      if (!profile) return;
      if (!availablePlayersByClubId[clubId]) availablePlayersByClubId[clubId] = [];
      if (availablePlayersByClubId[clubId].some((player) => player.id === playerId)) return;
      availablePlayersByClubId[clubId].push({
        id: playerId,
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        avatar_url: profile.avatar_url ?? null,
      });
    });

    const statsByCampId: Record<string, { invited: number; registered: number; coaches: number }> = {};
    const coachIdsByCampId: Record<string, string[]> = {};
    const playerIdsByCampId: Record<string, string[]> = {};
    const groupIdsByCampId: Record<string, string[]> = {};

    (campPlayersRes.data ?? []).forEach((row: any) => {
      const campId = String(row.camp_id ?? "").trim();
      const playerId = String(row.player_id ?? "").trim();
      if (!campId) return;
      if (!statsByCampId[campId]) statsByCampId[campId] = { invited: 0, registered: 0, coaches: 0 };
      statsByCampId[campId].invited += 1;
      if (normalizeRegistrationStatus(row.registration_status) === "registered") {
        statsByCampId[campId].registered += 1;
      }
      if (playerId) {
        if (!playerIdsByCampId[campId]) playerIdsByCampId[campId] = [];
        playerIdsByCampId[campId].push(playerId);
      }
    });

    const campCoachRowsRes = campIds.length
      ? await supabaseAdmin
          .from("club_camp_coaches")
          .select("camp_id,coach_id,is_head")
          .in("camp_id", campIds)
      : ({ data: [], error: null } as const);
    if (campCoachRowsRes.error) return NextResponse.json({ error: campCoachRowsRes.error.message }, { status: 400 });

    (campCoachRowsRes.data ?? []).forEach((row: any) => {
      const campId = String(row.camp_id ?? "").trim();
      const coachId = String(row.coach_id ?? "").trim();
      if (!campId) return;
      if (!statsByCampId[campId]) statsByCampId[campId] = { invited: 0, registered: 0, coaches: 0 };
      statsByCampId[campId].coaches += 1;
      if (coachId && !Boolean(row.is_head)) {
        if (!coachIdsByCampId[campId]) coachIdsByCampId[campId] = [];
        coachIdsByCampId[campId].push(coachId);
      }
    });

    (daysRes.data ?? []).forEach((row: any) => {
      const campId = String(row.camp_id ?? "").trim();
      const groupId = String(row.club_events?.group_id ?? "").trim();
      if (!campId || !groupId) return;
      if (!groupIdsByCampId[campId]) groupIdsByCampId[campId] = [];
      groupIdsByCampId[campId].push(groupId);
    });

    const dayByEventId = new Map<string, any>();
    Object.values(daysByCampId).forEach((days) => {
      days.forEach((day) => dayByEventId.set(String(day.event_id), day));
    });

    const eventIds = Array.from(dayByEventId.keys());
    if (eventIds.length > 0) {
      const [attendeesRes, participantAttendanceRes] = await Promise.all([
        supabaseAdmin.from("club_event_attendees").select("event_id,player_id,status").in("event_id", eventIds),
        supabaseAdmin
          .from("club_event_attendees")
          .select("event_id,player_id,status")
          .in("event_id", eventIds)
          .eq("status", "present"),
      ]);
      if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
      if (participantAttendanceRes.error) return NextResponse.json({ error: participantAttendanceRes.error.message }, { status: 400 });

      const participantIds = uniq((participantAttendanceRes.data ?? []).map((row: any) => String(row.player_id ?? "").trim()));
      const participantProfilesRes = participantIds.length
        ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", participantIds)
        : ({ data: [], error: null } as const);
      if (participantProfilesRes.error) return NextResponse.json({ error: participantProfilesRes.error.message }, { status: 400 });

      const participantById = new Map<string, any>();
      (participantProfilesRes.data ?? []).forEach((profile: any) => {
        participantById.set(String(profile.id ?? "").trim(), profile);
      });

      const participantsByEventId: Record<string, ProfileLite[]> = {};
      (participantAttendanceRes.data ?? []).forEach((row: any) => {
        const eventId = String(row.event_id ?? "").trim();
        const playerId = String(row.player_id ?? "").trim();
        if (!eventId || !playerId) return;
        if (!participantsByEventId[eventId]) participantsByEventId[eventId] = [];
        const participant = participantById.get(playerId);
        if (!participant) return;
        participantsByEventId[eventId].push({
          id: playerId,
          first_name: participant.first_name ?? null,
          last_name: participant.last_name ?? null,
          avatar_url: participant.avatar_url ?? null,
        });
      });

      (attendeesRes.data ?? []).forEach((attendee: any) => {
        const eventId = String(attendee.event_id ?? "").trim();
        const day = dayByEventId.get(eventId);
        if (!day) return;
        const status = String(attendee.status ?? "not_registered");
        if (status === "present") day.counts.present += 1;
        else if (status === "absent") day.counts.absent += 1;
        else if (status === "excused") day.counts.excused += 1;
        else day.counts.not_registered += 1;

        const dayIndex = dayIndexByEventId[eventId];
        if (dayIndex != null && (status === "present" || status === "absent")) {
          Object.entries(daysByCampId).forEach(([campId, campDays]) => {
            const dayExists = campDays.some((campDay) => String(campDay.event_id ?? "").trim() === eventId);
            if (!dayExists) return;
            const registration = playerRegistrationByCampAndPlayer[campId]?.[String(attendee.player_id ?? "").trim()];
            if (!registration) return;
            registration.day_status_by_day_index[String(dayIndex)] = status;
          });
        }
      });

      Object.values(daysByCampId).forEach((days) => {
        days.forEach((day) => {
          day.participants = (participantsByEventId[String(day.event_id)] ?? []);
          day.participants_count = day.participants.length;
        });
      });
    }

    return NextResponse.json({
      camps: camps.map((camp: any) => {
        const campId = String(camp.id);
        return {
          ...camp,
          club_name: clubNameById.get(String(camp.club_id ?? "").trim()) ?? "Club",
          head_coach: headCoachById.get(String(camp.head_coach_user_id ?? "").trim()) ?? null,
          group_ids: uniq(groupIdsByCampId[campId] ?? []),
          player_ids: uniq(playerIdsByCampId[campId] ?? []),
          coach_ids: uniq(coachIdsByCampId[campId] ?? []),
          stats: statsByCampId[campId] ?? { invited: 0, registered: 0, coaches: 0 },
          player_registrations: (playerRegistrationsByCampId[campId] ?? []).map((registration) => ({
            ...registration,
            day_status_by_day_index: registration.day_status_by_day_index ?? {},
          })),
          available_players: availablePlayersByClubId[String(camp.club_id)] ?? [],
          days: (daysByCampId[campId] ?? []).sort((a, b) => Number(a.day_index ?? 0) - Number(b.day_index ?? 0)),
        };
      }),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clubId = normalizeText(body?.club_id);
    const title = normalizeText(body?.title);
    const notes = normalizeText(body?.notes) || null;
    const headCoachUserId = normalizeText(body?.head_coach_user_id) || null;
    const groupIds = uniqIds(body?.group_ids);
    const playerIds = uniqIds(body?.player_ids);
    const coachIds = uniqIds(body?.coach_ids);
    const days = (Array.isArray(body?.days) ? body.days : []) as CampCreateDayInput[];
    const playerRegistrations = (Array.isArray(body?.player_registrations) ? body.player_registrations : []) as CampPlayerRegistrationInput[];

    if (!clubId) return NextResponse.json({ error: "club_id required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (!headCoachUserId) return NextResponse.json({ error: "head_coach_user_id required" }, { status: 400 });
    if (groupIds.length === 0) return NextResponse.json({ error: "At least one group is required" }, { status: 400 });
    if (playerIds.length === 0) return NextResponse.json({ error: "At least one player is required" }, { status: 400 });
    if (days.length === 0) return NextResponse.json({ error: "At least one day is required" }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const managerCheck = await assertManagerForClub(supabaseAdmin, caller.userId, clubId);
    if ("error" in managerCheck) return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });

    const allCoachIds = uniq([headCoachUserId, ...coachIds]);
    const campRes = await supabaseAdmin
      .from("club_camps")
      .insert({
        club_id: clubId,
        title,
        notes,
        head_coach_user_id: headCoachUserId,
        created_by: caller.userId,
      })
      .select("id")
      .maybeSingle();
    if (campRes.error || !campRes.data?.id) {
      return NextResponse.json({ error: campRes.error?.message ?? "Unable to create camp" }, { status: 400 });
    }

    const campId = String(campRes.data.id);
    const primaryGroupId = groupIds[0];
    const registrationByPlayerId = new Map<
      string,
      { registration_status: string; registered_at: string | null; day_status_by_day_index: Record<string, string> }
    >();
    playerIds.forEach((playerId) => {
      registrationByPlayerId.set(playerId, {
        registration_status: "invited",
        registered_at: null,
        day_status_by_day_index: {},
      });
    });
    playerRegistrations.forEach((registration) => {
      const playerId = normalizeText(registration?.player_id);
      if (!playerId || !registrationByPlayerId.has(playerId)) return;
      const registrationStatus = normalizeRegistrationStatus(registration?.registration_status);
      const next = registrationByPlayerId.get(playerId)!;
      next.registration_status = registrationStatus;
      next.registered_at = registrationStatus === "registered" ? new Date().toISOString() : null;
      const rawDayStatuses = registration?.day_status_by_day_index ?? {};
      Object.entries(rawDayStatuses).forEach(([dayIndex, status]) => {
        next.day_status_by_day_index[String(dayIndex)] = normalizeDayStatus(status);
      });
    });

    if (groupIds.length > 0) {
      const groupsInsert = await supabaseAdmin
        .from("club_camp_groups")
        .insert(groupIds.map((groupId) => ({ camp_id: campId, group_id: groupId })));
      if (groupsInsert.error) return NextResponse.json({ error: groupsInsert.error.message }, { status: 400 });
    }

    if (playerIds.length > 0) {
      const playersInsert = await supabaseAdmin.from("club_camp_players").insert(
        playerIds.map((playerId) => ({
          camp_id: campId,
          player_id: playerId,
          registration_status: registrationByPlayerId.get(playerId)?.registration_status ?? "invited",
          registered_at: registrationByPlayerId.get(playerId)?.registered_at ?? null,
        }))
      );
      if (playersInsert.error) return NextResponse.json({ error: playersInsert.error.message }, { status: 400 });
    }

    if (allCoachIds.length > 0) {
      const coachesInsert = await supabaseAdmin.from("club_camp_coaches").insert(
        allCoachIds.map((coachId) => ({
          camp_id: campId,
          coach_id: coachId,
          is_head: coachId === headCoachUserId,
        }))
      );
      if (coachesInsert.error) return NextResponse.json({ error: coachesInsert.error.message }, { status: 400 });
    }

    const createdDays: Array<{ event_id: string; day_index: number }> = [];

    for (let index = 0; index < days.length; index += 1) {
      const day = days[index];
      const startsAt = localDateTimeInputToIso(normalizeText(day?.starts_at));
      const endsAt = localDateTimeInputToIso(normalizeText(day?.ends_at));
      const locationText = normalizeText(day?.location_text) || null;
      const practicalInfo = normalizeText(day?.practical_info) || null;
      const createdDay = await createCampDayEvent(supabaseAdmin, {
        campId,
        clubId,
        primaryGroupId,
        title,
        startsAt,
        endsAt,
        locationText,
        practicalInfo,
        headCoachUserId,
        coachIds: uniq([...allCoachIds, ...uniqIds(day?.coach_ids)]),
        playerIds,
        attendeeStatusByPlayerId: Object.fromEntries(
          playerIds.map((playerId) => {
            const registration = registrationByPlayerId.get(playerId);
            if (registration?.registration_status !== "registered") return [playerId, "not_registered"];
            return [playerId, registration.day_status_by_day_index[String(index)] ?? "present"];
          })
        ),
        callerUserId: caller.userId,
        dayIndex: index,
      });
      if ("error" in createdDay) return NextResponse.json({ error: createdDay.error }, { status: createdDay.status });
      createdDays.push({ event_id: createdDay.eventId, day_index: index });
    }

    return NextResponse.json({ ok: true, camp_id: campId, days: createdDays });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
