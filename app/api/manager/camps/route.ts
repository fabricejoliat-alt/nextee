/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import {
  assertManagerForClub,
  createAdminClient,
  getCaller,
  normalizeText,
  uniq,
} from "@/app/api/camps/_lib";
import { saveManagerCamp } from "@/lib/server/managerCampSave";

export type CampCreateDayInput = {
  event_id?: string | null;
  starts_at: string;
  ends_at: string;
  location_text?: string | null;
  practical_info?: string | null;
  coach_ids?: string[];
  responsible_coach_id?: string | null;
  evaluation_enabled?: boolean;
  evaluation_criterion_ids?: string[];
};

export type CampOptionInput = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  is_active?: boolean;
  applies_to_all_days?: boolean;
  day_indexes?: number[];
  capacity?: number | null;
  allows_quantity?: boolean;
  input_type?: "checkbox" | "yes_no" | "select" | "radio" | null;
  choices?: string[] | null;
  internal_note?: string | null;
  player_assignments?: Array<{ player_id?: string | null; quantity?: number | null; note?: string | null; selected_value?: string | null }>;
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

const VALID_CAMP_DAY_STATUSES = new Set(["expected", "present", "absent", "excused", "not_registered"]);
function normalizeRegistrationStatus(value: unknown) {
  const status = normalizeText(value).toLowerCase();
  return ["invited", "registered", "declined"].includes(status) ? status : "invited";
}

function uniqIds(values: unknown) {
  return uniq(Array.isArray(values) ? values.map((value) => String(value ?? "").trim()) : []);
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

    const requestedCampId = new URL(req.url).searchParams.get("camp_id");
    const versions = requestedCampId
      ? await supabaseAdmin.rpc("get_manager_camp_versions_v1", { p_actor: caller.userId, p_club_ids: managedClubIds, p_camp: requestedCampId })
      : { data: {}, error: null };
    if (versions.error) return NextResponse.json({ error: "Le chargement des stages est indisponible. Réessayez ultérieurement." }, { status: 503 });

    let campsQuery = supabaseAdmin.from("club_camps").select("*").in("club_id", managedClubIds);
    if (requestedCampId) campsQuery = campsQuery.eq("id", requestedCampId);
    const campsRes = await campsQuery.order("created_at", { ascending: false });
    if (campsRes.error) return NextResponse.json({ error: campsRes.error.message }, { status: 400 });

    const camps = campsRes.data ?? [];
    const campIds = uniq(camps.map((camp: any) => camp.id));
    const clubIds = uniq(camps.map((camp: any) => camp.club_id));
    const headCoachIds = uniq(camps.map((camp: any) => camp.head_coach_user_id));

    const [daysRes, campPlayersRes, clubRes, profileRes, clubPlayerMembershipsRes] = await Promise.all([
      campIds.length
        ? supabaseAdmin
            .from("club_camp_days")
            .select("id,camp_id,event_id,day_index,practical_info,starts_at,ends_at,location_text,responsible_coach_id,evaluation_enabled,club_events:event_id(id,status,group_id,requires_evaluation)")
            .in("camp_id", campIds)
            .order("day_index", { ascending: true })
        : ({ data: [], error: null } as const),
      campIds.length
        ? supabaseAdmin
            .from("club_camp_players")
            .select("camp_id,player_id,registration_status")
            .in("camp_id", campIds)
        : ({ data: [], error: null } as const),
      clubIds.length ? supabaseAdmin.from("organizations").select("id,name").in("id", clubIds) : ({ data: [], error: null } as const),
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
        id: String(row.id ?? ""),
        event_id: eventId,
        day_index: Number(row.day_index ?? 0),
        practical_info: row.practical_info ?? null,
        starts_at: row.starts_at ?? null,
        ends_at: row.ends_at ?? null,
        location_text: row.location_text ?? null,
        responsible_coach_id: row.responsible_coach_id ?? null,
        evaluation_enabled: Boolean(row.evaluation_enabled ?? row.club_events?.requires_evaluation),
        coach_ids: [] as string[],
        status: row.club_events?.status ?? "scheduled",
        group_id: String(row.club_events?.group_id ?? ""),
        counts: { present: 0, not_registered: 0, absent: 0, excused: 0 },
        participants_count: 0,
        participants: [] as Array<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>,
        evaluation: { required: 0, completed: 0 },
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

    const [campCoachRowsRes, campGroupRowsRes] = await Promise.all([
      campIds.length
        ? supabaseAdmin.from("club_camp_coaches").select("camp_id,coach_id,is_head").in("camp_id", campIds)
        : ({ data: [], error: null } as const),
      campIds.length
        ? supabaseAdmin.from("club_camp_groups").select("camp_id,group_id").in("camp_id", campIds)
        : ({ data: [], error: null } as const),
    ]);
    if (campCoachRowsRes.error) return NextResponse.json({ error: campCoachRowsRes.error.message }, { status: 400 });
    if (campGroupRowsRes.error) return NextResponse.json({ error: campGroupRowsRes.error.message }, { status: 400 });

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

    (campGroupRowsRes.data ?? []).forEach((row: any) => {
      const campId = String(row.camp_id ?? "").trim();
      const groupId = String(row.group_id ?? "").trim();
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
      const [attendeesRes, participantAttendanceRes, feedbackRes, eventCoachesRes, eventCriteriaRes] = await Promise.all([
        supabaseAdmin.from("club_event_attendees").select("event_id,player_id,status").in("event_id", eventIds),
        supabaseAdmin
          .from("club_event_attendees")
          .select("event_id,player_id,status")
          .in("event_id", eventIds)
          .eq("status", "present"),
        supabaseAdmin.from("club_event_coach_feedback").select("event_id,player_id").in("event_id", eventIds),
        supabaseAdmin.from("club_event_coaches").select("event_id,coach_id").in("event_id", eventIds),
        supabaseAdmin.from("club_event_evaluation_criteria").select("event_id,criterion_id,position").in("event_id", eventIds).eq("is_enabled", true).order("position"),
      ]);
      if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
      if (participantAttendanceRes.error) return NextResponse.json({ error: participantAttendanceRes.error.message }, { status: 400 });
      if (feedbackRes.error) return NextResponse.json({ error: feedbackRes.error.message }, { status: 400 });
      if (eventCoachesRes.error) return NextResponse.json({ error: eventCoachesRes.error.message }, { status: 400 });
      if (eventCriteriaRes.error) return NextResponse.json({ error: eventCriteriaRes.error.message }, { status: 400 });

      (eventCriteriaRes.data ?? []).forEach((row: any) => {
        const day = dayByEventId.get(String(row.event_id ?? ""));
        if (!day) return;
        if (!Array.isArray(day.evaluation_criterion_ids)) day.evaluation_criterion_ids = [];
        day.evaluation_criterion_ids.push(String(row.criterion_id ?? ""));
      });

      (eventCoachesRes.data ?? []).forEach((row: any) => {
        const day = dayByEventId.get(String(row.event_id ?? ""));
        const coachId = String(row.coach_id ?? "").trim();
        if (!day || !coachId) return;
        if (!Array.isArray(day.coach_ids)) day.coach_ids = [];
        day.coach_ids.push(coachId);
      });

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
        if (day.evaluation_enabled && status !== "not_registered" && status !== "absent" && status !== "excused") {
          day.evaluation.required += 1;
        }

        const dayIndex = dayIndexByEventId[eventId];
        if (dayIndex != null && VALID_CAMP_DAY_STATUSES.has(status)) {
          Object.entries(daysByCampId).forEach(([campId, campDays]) => {
            const dayExists = campDays.some((campDay) => String(campDay.event_id ?? "").trim() === eventId);
            if (!dayExists) return;
            const registration = playerRegistrationByCampAndPlayer[campId]?.[String(attendee.player_id ?? "").trim()];
            if (!registration) return;
            registration.day_status_by_day_index[String(dayIndex)] = status;
          });
        }
      });

      const completedEvaluationKeys = new Set<string>();
      (feedbackRes.data ?? []).forEach((feedback: any) => {
        const eventId = String(feedback.event_id ?? "").trim();
        const playerId = String(feedback.player_id ?? "").trim();
        const day = dayByEventId.get(eventId);
        const key = `${eventId}:${playerId}`;
        if (!day?.evaluation_enabled || !playerId || completedEvaluationKeys.has(key)) return;
        completedEvaluationKeys.add(key);
        day.evaluation.completed += 1;
      });

      Object.values(daysByCampId).forEach((days) => {
        days.forEach((day) => {
          day.participants = (participantsByEventId[String(day.event_id)] ?? []);
          day.participants_count = day.participants.length;
        });
      });
    }

    const optionsRes = campIds.length
      ? await supabaseAdmin.from("club_camp_options").select("id,camp_id,name,description,is_active,applies_to_all_days,capacity,allows_quantity,input_type,choices,internal_note,sort_order").in("camp_id", campIds).order("sort_order", { ascending: true })
      : ({ data: [], error: null } as const);
    if (optionsRes.error) return NextResponse.json({ error: optionsRes.error.message }, { status: 400 });
    const optionIds = uniq((optionsRes.data ?? []).map((option: any) => option.id));
    const [optionDaysRes, optionAssignmentsRes] = await Promise.all([
      optionIds.length
        ? supabaseAdmin.from("club_camp_option_days").select("option_id,camp_day_id").in("option_id", optionIds)
        : ({ data: [], error: null } as const),
      optionIds.length
        ? supabaseAdmin.from("club_camp_player_options").select("option_id,player_id,quantity,note,selected_value").in("option_id", optionIds)
        : ({ data: [], error: null } as const),
    ]);
    if (optionDaysRes.error) return NextResponse.json({ error: optionDaysRes.error.message }, { status: 400 });
    if (optionAssignmentsRes.error) return NextResponse.json({ error: optionAssignmentsRes.error.message }, { status: 400 });

    const dayIndexByDayId = new Map<string, number>();
    Object.values(daysByCampId).flat().forEach((day: any) => dayIndexByDayId.set(String(day.id), Number(day.day_index ?? 0)));
    const dayIndexesByOptionId: Record<string, number[]> = {};
    (optionDaysRes.data ?? []).forEach((row: any) => {
      const optionId = String(row.option_id ?? "");
      const dayIndex = dayIndexByDayId.get(String(row.camp_day_id ?? ""));
      if (dayIndex == null) return;
      if (!dayIndexesByOptionId[optionId]) dayIndexesByOptionId[optionId] = [];
      dayIndexesByOptionId[optionId].push(dayIndex);
    });
    const assignmentsByOptionId: Record<string, any[]> = {};
    (optionAssignmentsRes.data ?? []).forEach((row: any) => {
      const optionId = String(row.option_id ?? "");
      if (!assignmentsByOptionId[optionId]) assignmentsByOptionId[optionId] = [];
      assignmentsByOptionId[optionId].push({ player_id: row.player_id, quantity: Number(row.quantity ?? 1), note: row.note ?? null, selected_value: row.selected_value ?? null });
    });
    const optionsByCampId: Record<string, any[]> = {};
    (optionsRes.data ?? []).forEach((option: any) => {
      const campId = String(option.camp_id ?? "");
      if (!optionsByCampId[campId]) optionsByCampId[campId] = [];
      const assignments = assignmentsByOptionId[String(option.id)] ?? [];
      optionsByCampId[campId].push({
        ...option,
        day_indexes: dayIndexesByOptionId[String(option.id)] ?? [],
        player_assignments: assignments,
        assigned_count: assignments.length,
        assigned_quantity: assignments.reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0),
      });
    });

    return NextResponse.json({
      camps: camps.map((camp: any) => {
        const campId = String(camp.id);
        return {
          ...camp,
          edit_version: versions.data?.[campId] ?? null,
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
          options: optionsByCampId[campId] ?? [],
          evaluation: (daysByCampId[campId] ?? []).reduce((summary, day) => ({
            required: summary.required + Number(day.evaluation?.required ?? 0),
            completed: summary.completed + Number(day.evaluation?.completed ?? 0),
          }), { required: 0, completed: 0 }),
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
    const headCoachUserId = normalizeText(body?.head_coach_user_id) || null;
    const groupIds = uniqIds(body?.group_ids);
    const playerIds = uniqIds(body?.player_ids);
    const days = (Array.isArray(body?.days) ? body.days : []) as CampCreateDayInput[];
    const status = normalizeText(body?.status) === "draft" ? "draft" : "scheduled";
    const capacityRaw = body?.capacity == null || body.capacity === "" ? null : Number(body.capacity);
    const capacity = capacityRaw != null && Number.isFinite(capacityRaw) ? Math.max(1, Math.trunc(capacityRaw)) : null;

    if (!clubId) return NextResponse.json({ error: "club_id required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (status !== "draft" && !headCoachUserId) return NextResponse.json({ error: "Le head coach est requis pour planifier le stage." }, { status: 400 });
    if (status !== "draft" && groupIds.length === 0 && playerIds.length === 0) return NextResponse.json({ error: "Ajoutez au moins un groupe ou un junior." }, { status: 400 });
    if (status !== "draft" && days.length === 0) return NextResponse.json({ error: "Ajoutez au moins une journée." }, { status: 400 });
    if (days.length > 0 && !headCoachUserId) return NextResponse.json({ error: "Un head coach est requis dès qu’une journée est définie." }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const managerCheck = await assertManagerForClub(supabaseAdmin, caller.userId, clubId);
    if ("error" in managerCheck) return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });

    const saved = await saveManagerCamp(supabaseAdmin, caller.userId, null, clubId, { ...body, status, capacity });
    return NextResponse.json(saved.data, { status: saved.status });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
