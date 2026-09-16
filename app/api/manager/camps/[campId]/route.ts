/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import {
  assertManagerForClub,
  assertCampRelationsForClub,
  createAdminClient,
  createCampSupportGroup,
  createCampDayEvent,
  deleteClubEventDeep,
  getCaller,
  localDateTimeInputToIso,
  minutesBetween,
  normalizeText,
  uniq,
  syncEventEvaluationCriteria,
} from "@/app/api/camps/_lib";
import { syncCampOptions } from "@/app/api/camps/options";
import type { CampCreateDayInput, CampOptionInput } from "@/app/api/manager/camps/route";

function uniqIds(values: unknown) {
  return uniq(Array.isArray(values) ? values.map((value) => String(value ?? "").trim()) : []);
}

type CampPlayerRegistrationInput = {
  player_id?: string | null;
  registration_status?: string | null;
  day_status_by_day_index?: Record<string, string | null | undefined> | null;
};

const VALID_CAMP_REGISTRATION_STATUSES = new Set(["invited", "registered", "declined"]);
const VALID_CAMP_DAY_STATUSES = new Set(["expected", "present", "absent", "excused", "not_registered"]);

function normalizeRegistrationStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_CAMP_REGISTRATION_STATUSES.has(normalized) ? normalized : "invited";
}

function normalizeDayStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_CAMP_DAY_STATUSES.has(normalized) ? normalized : "expected";
}

async function resolveCamp(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  campId: string
): Promise<{ error: string; status: number } | { camp: { id: string; club_id: string } }> {
  const campRes = await supabaseAdmin.from("club_camps").select("id,club_id").eq("id", campId).maybeSingle();
  if (campRes.error) return { error: campRes.error.message, status: 400 };
  if (!campRes.data?.id) return { error: "Stage/camp introuvable.", status: 404 };
  return { camp: { id: String(campRes.data.id), club_id: String(campRes.data.club_id ?? "").trim() } };
}

async function deleteCampDays(supabaseAdmin: ReturnType<typeof createAdminClient>, campId: string) {
  const dayIdsRes = await supabaseAdmin.from("club_camp_days").select("event_id").eq("camp_id", campId).order("day_index", { ascending: true });
  if (dayIdsRes.error) return { error: dayIdsRes.error.message, status: 400 as const };

  const eventIds = uniq((dayIdsRes.data ?? []).map((row: any) => row.event_id));
  for (const eventId of eventIds) {
    const deleted = await deleteClubEventDeep(supabaseAdmin, eventId);
    if ("error" in deleted) return deleted;
  }
  return { ok: true as const };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ campId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { campId: rawCampId } = await ctx.params;
    const campId = normalizeText(rawCampId);
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const title = normalizeText(body?.title);
    const notes = normalizeText(body?.notes) || null;
    const headCoachUserId = normalizeText(body?.head_coach_user_id) || null;
    let groupIds = uniqIds(body?.group_ids);
    const playerIds = uniqIds(body?.player_ids);
    const coachIds = uniqIds(body?.coach_ids);
    const days = (Array.isArray(body?.days) ? body.days : []) as CampCreateDayInput[];
    const playerRegistrations = (Array.isArray(body?.player_registrations) ? body.player_registrations : []) as CampPlayerRegistrationInput[];
    const options = (Array.isArray(body?.options) ? body.options : []) as CampOptionInput[];
    const action = normalizeText(body?.action);
    const status = ["draft", "scheduled", "cancelled"].includes(normalizeText(body?.status)) ? normalizeText(body?.status) : "scheduled";
    const capacityRaw = body?.capacity == null || body.capacity === "" ? null : Number(body.capacity);
    const capacity = capacityRaw != null && Number.isFinite(capacityRaw) ? Math.max(1, Math.trunc(capacityRaw)) : null;
    const seasonId = normalizeText(body?.season_id) || null;

    if (!action && !title) return NextResponse.json({ error: "Le nom du stage est requis." }, { status: 400 });
    if (!action && status !== "draft" && !headCoachUserId) return NextResponse.json({ error: "Le head coach est requis pour planifier le stage." }, { status: 400 });
    if (!action && status !== "draft" && groupIds.length === 0 && playerIds.length === 0) return NextResponse.json({ error: "Ajoutez au moins un groupe ou un junior." }, { status: 400 });
    if (!action && status !== "draft" && days.length === 0) return NextResponse.json({ error: "Ajoutez au moins une journée." }, { status: 400 });
    if (!action && status !== "draft" && days.length > 0 && !headCoachUserId) return NextResponse.json({ error: "Un head coach est requis dès qu’une journée est définie." }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const resolved = await resolveCamp(supabaseAdmin, campId);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

    const managerCheck = await assertManagerForClub(supabaseAdmin, caller.userId, resolved.camp.club_id);
    if ("error" in managerCheck) return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });

    if (action === "archive") {
      const archiveRes = await supabaseAdmin.from("club_camps").update({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campId);
      if (archiveRes.error) return NextResponse.json({ error: archiveRes.error.message }, { status: 400 });
      return NextResponse.json({ ok: true, camp_id: campId });
    }

    if (action === "set_attendance") {
      const eventId = normalizeText(body?.event_id);
      const updates = (Array.isArray(body?.attendance_updates) ? body.attendance_updates : [])
        .map((entry: any) => ({ player_id: normalizeText(entry?.player_id), status: normalizeDayStatus(entry?.status) }))
        .filter((entry: { player_id: string }) => entry.player_id);
      if (!eventId || updates.length === 0) return NextResponse.json({ error: "Présences manquantes." }, { status: 400 });
      const dayCheck = await supabaseAdmin.from("club_camp_days").select("event_id").eq("camp_id", campId).eq("event_id", eventId).maybeSingle();
      if (dayCheck.error) return NextResponse.json({ error: dayCheck.error.message }, { status: 400 });
      if (!dayCheck.data?.event_id) return NextResponse.json({ error: "Journée introuvable." }, { status: 404 });
      const participantsRes = await supabaseAdmin.from("club_camp_players").select("player_id").eq("camp_id", campId);
      if (participantsRes.error) return NextResponse.json({ error: participantsRes.error.message }, { status: 400 });
      const allowed = new Set((participantsRes.data ?? []).map((row: any) => String(row.player_id)));
      const safeUpdates = updates.filter((entry: { player_id: string }) => allowed.has(entry.player_id));
      if (safeUpdates.length !== updates.length) return NextResponse.json({ error: "Un junior ne fait pas partie de ce stage." }, { status: 400 });
      const upsertRes = await supabaseAdmin.from("club_event_attendees").upsert(
        safeUpdates.map((entry: { player_id: string; status: string }) => ({ event_id: eventId, ...entry })),
        { onConflict: "event_id,player_id" }
      );
      if (upsertRes.error) return NextResponse.json({ error: upsertRes.error.message }, { status: 400 });
      return NextResponse.json({ ok: true, camp_id: campId });
    }

    const dayCoachIds = uniq(days.flatMap((day) => [normalizeText(day?.responsible_coach_id), ...uniqIds(day?.coach_ids)]));
    const relationCheck = await assertCampRelationsForClub(supabaseAdmin, resolved.camp.club_id, groupIds, playerIds, uniq([headCoachUserId, ...coachIds, ...dayCoachIds]), seasonId);
    if ("error" in relationCheck) return NextResponse.json({ error: relationCheck.error }, { status: relationCheck.status });

    if (days.length > 0 && groupIds.length === 0) {
      const supportGroup = await createCampSupportGroup(supabaseAdmin, resolved.camp.club_id, headCoachUserId, playerIds, uniq([headCoachUserId, ...coachIds, ...dayCoachIds]), seasonId);
      if ("error" in supportGroup) return NextResponse.json({ error: supportGroup.error }, { status: supportGroup.status });
      groupIds = [supportGroup.groupId];
    }

    const primaryGroupId = groupIds[0];
    const allCoachIds = uniq([headCoachUserId, ...coachIds, ...dayCoachIds]);
    const existingDaysRes = await supabaseAdmin
      .from("club_camp_days")
      .select("id,event_id,day_index,starts_at,ends_at")
      .eq("camp_id", campId)
      .order("day_index", { ascending: true });
    if (existingDaysRes.error) return NextResponse.json({ error: existingDaysRes.error.message }, { status: 400 });

    const existingCampPlayersRes = await supabaseAdmin
      .from("club_camp_players")
      .select("player_id,registration_status,registered_at")
      .eq("camp_id", campId);
    if (existingCampPlayersRes.error) return NextResponse.json({ error: existingCampPlayersRes.error.message }, { status: 400 });

    const existingDayByEventId = new Map<string, { id: string; event_id: string; day_index: number; starts_at: string | null; ends_at: string | null }>();
    (existingDaysRes.data ?? []).forEach((row: any) => {
      const eventId = String(row.event_id ?? "").trim();
      if (!eventId) return;
      existingDayByEventId.set(eventId, {
        id: String(row.id ?? ""),
        event_id: eventId,
        day_index: Number(row.day_index ?? 0),
        starts_at: row.starts_at ?? null,
        ends_at: row.ends_at ?? null,
      });
    });

    const existingPlayerById = new Map<
      string,
      { player_id: string; registration_status: string; registered_at: string | null }
    >();
    (existingCampPlayersRes.data ?? []).forEach((row: any) => {
      const playerId = String(row.player_id ?? "").trim();
      if (!playerId) return;
      existingPlayerById.set(playerId, {
        player_id: playerId,
        registration_status: String(row.registration_status ?? "invited"),
        registered_at: row.registered_at ?? null,
      });
    });

    const registrationByPlayerId = new Map<
      string,
      { registration_status: string; registered_at: string | null; day_status_by_day_index: Record<string, string> }
    >();
    playerIds.forEach((playerId) => {
      const existing = existingPlayerById.get(playerId);
      registrationByPlayerId.set(playerId, {
        registration_status: normalizeRegistrationStatus(existing?.registration_status),
        registered_at: existing?.registered_at ?? null,
        day_status_by_day_index: {},
      });
    });
    playerRegistrations.forEach((registration) => {
      const playerId = normalizeText(registration?.player_id);
      if (!playerId || !registrationByPlayerId.has(playerId)) return;
      const next = registrationByPlayerId.get(playerId)!;
      const registrationStatus = normalizeRegistrationStatus(registration?.registration_status);
      next.registration_status = registrationStatus;
      next.registered_at =
        registrationStatus === "registered"
          ? existingPlayerById.get(playerId)?.registered_at ?? new Date().toISOString()
          : null;
      const rawDayStatuses = registration?.day_status_by_day_index ?? {};
      Object.entries(rawDayStatuses).forEach(([dayIndex, status]) => {
        next.day_status_by_day_index[String(dayIndex)] = normalizeDayStatus(status);
      });
    });

    const incomingDayEventIds = uniq(
      days.map((day: any) => normalizeText(day?.event_id)).filter((eventId) => existingDayByEventId.has(eventId))
    );
    const deletedEventIds = Array.from(existingDayByEventId.keys()).filter((eventId) => !incomingDayEventIds.includes(eventId));

    for (const eventId of deletedEventIds) {
      const existingDay = existingDayByEventId.get(eventId);
      const [attendanceRes, coachFeedbackRes, playerFeedbackRes, optionUseRes] = await Promise.all([
        supabaseAdmin.from("club_event_attendees").select("player_id", { count: "exact", head: true }).eq("event_id", eventId).in("status", ["present", "absent", "excused"]),
        supabaseAdmin.from("club_event_coach_feedback").select("player_id", { count: "exact", head: true }).eq("event_id", eventId),
        supabaseAdmin.from("club_event_player_feedback").select("player_id", { count: "exact", head: true }).eq("event_id", eventId),
        existingDay?.id
          ? supabaseAdmin.from("club_camp_option_days").select("option_id", { count: "exact", head: true }).eq("camp_day_id", existingDay.id)
          : Promise.resolve({ count: 0, error: null }),
      ]);
      const dependencyError = attendanceRes.error ?? coachFeedbackRes.error ?? playerFeedbackRes.error ?? optionUseRes.error;
      if (dependencyError) return NextResponse.json({ error: dependencyError.message }, { status: 400 });
      if ((attendanceRes.count ?? 0) + (coachFeedbackRes.count ?? 0) + (playerFeedbackRes.count ?? 0) + (optionUseRes.count ?? 0) > 0) {
        return NextResponse.json({ error: "Cette journée contient déjà des présences, des options ou des évaluations. Elle ne peut pas être supprimée." }, { status: 409 });
      }
    }

    const campUpdateRes = await supabaseAdmin
      .from("club_camps")
      .update({
        title,
        notes,
        head_coach_user_id: headCoachUserId,
        capacity,
        season_id: seasonId,
        status,
        archived_at: status === "archived" ? new Date().toISOString() : null,
        participants_snapshot_at: playerIds.length > 0 ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campId);
    if (campUpdateRes.error) return NextResponse.json({ error: campUpdateRes.error.message }, { status: 400 });

    const replaceCampScopedRows = async (table: string, rows: any[]) => {
      const delRes = await supabaseAdmin.from(table).delete().eq("camp_id", campId);
      if (delRes.error) return delRes.error;
      if (rows.length === 0) return null;
      const insRes = await supabaseAdmin.from(table).insert(rows);
      return insRes.error ?? null;
    };

    for (const [table, rows] of [
      ["club_camp_groups", groupIds.map((groupId) => ({ camp_id: campId, group_id: groupId }))],
      [
        "club_camp_coaches",
        allCoachIds.map((coachId) => ({
          camp_id: campId,
          coach_id: coachId,
          is_head: coachId === headCoachUserId,
        })),
      ],
    ] as const) {
      const error = await replaceCampScopedRows(table, rows as any[]);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const removedPlayerIds = Array.from(existingPlayerById.keys()).filter((playerId) => !playerIds.includes(playerId));
    const pastEventIds = Array.from(existingDayByEventId.values())
      .filter((day) => new Date(day.ends_at ?? day.starts_at ?? "").getTime() < Date.now())
      .map((day) => day.event_id);
    if (removedPlayerIds.length > 0 && pastEventIds.length > 0) {
      const historicalUseRes = await supabaseAdmin
        .from("club_event_attendees")
        .select("player_id", { count: "exact", head: true })
        .in("event_id", pastEventIds)
        .in("player_id", removedPlayerIds);
      if (historicalUseRes.error) return NextResponse.json({ error: historicalUseRes.error.message }, { status: 400 });
      if ((historicalUseRes.count ?? 0) > 0) {
        return NextResponse.json({ error: "Un junior ayant déjà participé à une journée passée ne peut pas être retiré du stage. Son historique doit être conservé." }, { status: 409 });
      }
    }

    const deleteCampPlayersRes = await supabaseAdmin.from("club_camp_players").delete().eq("camp_id", campId);
    if (deleteCampPlayersRes.error) return NextResponse.json({ error: deleteCampPlayersRes.error.message }, { status: 400 });
    if (playerIds.length > 0) {
      const insertCampPlayersRes = await supabaseAdmin.from("club_camp_players").insert(
        playerIds.map((playerId) => ({
          camp_id: campId,
          player_id: playerId,
          registration_status: registrationByPlayerId.get(playerId)?.registration_status ?? "invited",
          registered_at: registrationByPlayerId.get(playerId)?.registered_at ?? null,
        }))
      );
      if (insertCampPlayersRes.error) return NextResponse.json({ error: insertCampPlayersRes.error.message }, { status: 400 });
    }

    for (const eventId of deletedEventIds) {
      const deleted = await deleteClubEventDeep(supabaseAdmin, eventId);
      if ("error" in deleted) return NextResponse.json({ error: deleted.error }, { status: deleted.status });
    }

    // Move existing rows to temporary negative indexes first so swapping two days
    // never collides with the unique (camp_id, day_index) constraint.
    for (const [eventId, existingDay] of existingDayByEventId.entries()) {
      if (deletedEventIds.includes(eventId)) continue;
      const temporaryIndexRes = await supabaseAdmin
        .from("club_camp_days")
        .update({ day_index: -100000 - existingDay.day_index })
        .eq("camp_id", campId)
        .eq("event_id", eventId);
      if (temporaryIndexRes.error) return NextResponse.json({ error: temporaryIndexRes.error.message }, { status: 400 });
    }

    const createdDays: Array<{ event_id: string; day_index: number }> = [];
    for (let index = 0; index < days.length; index += 1) {
      const day = days[index] as CampCreateDayInput & { event_id?: string | null };
      const eventId = normalizeText(day?.event_id);
      const startsAt = localDateTimeInputToIso(normalizeText(day?.starts_at));
      const endsAt = localDateTimeInputToIso(normalizeText(day?.ends_at));
      const locationText = normalizeText(day?.location_text) || null;
      const practicalInfo = normalizeText(day?.practical_info) || null;
      const desiredCoachIds = uniq([headCoachUserId, normalizeText(day?.responsible_coach_id) || headCoachUserId, ...uniqIds(day?.coach_ids)]);
      const durationMinutesRaw = minutesBetween(startsAt, endsAt);
      if (!startsAt || !endsAt || durationMinutesRaw <= 0) {
        return NextResponse.json({ error: `Invalid day ${index + 1}` }, { status: 400 });
      }

      if (eventId && existingDayByEventId.has(eventId)) {
        const durationMinutes = Math.min(300, durationMinutesRaw);
        const updateEventRes = await supabaseAdmin
          .from("club_events")
          .update({
            group_id: primaryGroupId,
            title,
            starts_at: startsAt,
            ends_at: endsAt,
            duration_minutes: durationMinutes,
            location_text: locationText,
            coach_note: practicalInfo,
            requires_evaluation: Boolean(day?.evaluation_enabled),
          })
          .eq("id", eventId);
        if (updateEventRes.error) return NextResponse.json({ error: updateEventRes.error.message }, { status: 400 });

        const updateCampDayRes = await supabaseAdmin
          .from("club_camp_days")
          .update({
            day_index: index,
            practical_info: practicalInfo,
            starts_at: startsAt,
            ends_at: endsAt,
            location_text: locationText,
            responsible_coach_id: normalizeText(day?.responsible_coach_id) || headCoachUserId,
            evaluation_enabled: Boolean(day?.evaluation_enabled),
            updated_at: new Date().toISOString(),
          })
          .eq("camp_id", campId)
          .eq("event_id", eventId);
        if (updateCampDayRes.error) return NextResponse.json({ error: updateCampDayRes.error.message }, { status: 400 });

        const deleteEventCoachesRes = await supabaseAdmin.from("club_event_coaches").delete().eq("event_id", eventId);
        if (deleteEventCoachesRes.error) return NextResponse.json({ error: deleteEventCoachesRes.error.message }, { status: 400 });
        if (desiredCoachIds.length > 0) {
          const insertEventCoachesRes = await supabaseAdmin.from("club_event_coaches").insert(
            desiredCoachIds.map((coachId) => ({ event_id: eventId, coach_id: coachId }))
          );
          if (insertEventCoachesRes.error) return NextResponse.json({ error: insertEventCoachesRes.error.message }, { status: 400 });
        }

        const existingDay = existingDayByEventId.get(eventId);
        const isHistoricalDay = new Date(existingDay?.ends_at ?? existingDay?.starts_at ?? "").getTime() < Date.now();
        if (!isHistoricalDay) {
          const deleteAttendeesRes = await supabaseAdmin.from("club_event_attendees").delete().eq("event_id", eventId);
          if (deleteAttendeesRes.error) return NextResponse.json({ error: deleteAttendeesRes.error.message }, { status: 400 });
          if (playerIds.length > 0) {
            const insertAttendeesRes = await supabaseAdmin.from("club_event_attendees").insert(
              playerIds.map((playerId) => {
                const registration = registrationByPlayerId.get(playerId);
                return {
                  event_id: eventId,
                  player_id: playerId,
                  status:
                    registration?.registration_status === "registered"
                      ? registration.day_status_by_day_index[String(index)] ?? "expected"
                      : "not_registered",
                };
              })
            );
            if (insertAttendeesRes.error) return NextResponse.json({ error: insertAttendeesRes.error.message }, { status: 400 });
          }
        }

        const criteriaSync = await syncEventEvaluationCriteria(supabaseAdmin, eventId, Boolean(day?.evaluation_enabled) ? uniqIds(day?.evaluation_criterion_ids) : []);
        if ("error" in criteriaSync) return NextResponse.json({ error: criteriaSync.error }, { status: criteriaSync.status });
        createdDays.push({ event_id: eventId, day_index: index });
        continue;
      }

      const createdDay = await createCampDayEvent(supabaseAdmin, {
        campId,
        clubId: resolved.camp.club_id,
        primaryGroupId,
        title,
        startsAt,
        endsAt,
        locationText,
        practicalInfo,
        responsibleCoachId: normalizeText(day?.responsible_coach_id) || headCoachUserId,
        evaluationEnabled: Boolean(day?.evaluation_enabled),
        headCoachUserId,
        coachIds: desiredCoachIds,
        playerIds,
        attendeeStatusByPlayerId: Object.fromEntries(
          playerIds.map((playerId) => {
            const registration = registrationByPlayerId.get(playerId);
            if (registration?.registration_status !== "registered") return [playerId, "not_registered"];
            return [playerId, registration.day_status_by_day_index[String(index)] ?? "expected"];
          })
        ),
        callerUserId: caller.userId,
        dayIndex: index,
      });
      if ("error" in createdDay) return NextResponse.json({ error: createdDay.error }, { status: createdDay.status });
      const criteriaSync = await syncEventEvaluationCriteria(supabaseAdmin, createdDay.eventId, Boolean(day?.evaluation_enabled) ? uniqIds(day?.evaluation_criterion_ids) : []);
      if ("error" in criteriaSync) return NextResponse.json({ error: criteriaSync.error }, { status: criteriaSync.status });
      createdDays.push({ event_id: createdDay.eventId, day_index: index });
    }

    const optionsSync = await syncCampOptions(supabaseAdmin, campId, options, caller.userId);
    if ("error" in optionsSync) return NextResponse.json({ error: optionsSync.error }, { status: optionsSync.status });

    return NextResponse.json({ ok: true, camp_id: campId, days: createdDays });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ campId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { campId: rawCampId } = await ctx.params;
    const campId = normalizeText(rawCampId);
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const resolved = await resolveCamp(supabaseAdmin, campId);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

    const managerCheck = await assertManagerForClub(supabaseAdmin, caller.userId, resolved.camp.club_id);
    if ("error" in managerCheck) return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });

    const deleteDaysRes = await deleteCampDays(supabaseAdmin, campId);
    if ("error" in deleteDaysRes) return NextResponse.json({ error: deleteDaysRes.error }, { status: deleteDaysRes.status });

    const deleteCampRes = await supabaseAdmin.from("club_camps").delete().eq("id", campId);
    if (deleteCampRes.error) return NextResponse.json({ error: deleteCampRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, deleted_camp_id: campId });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
