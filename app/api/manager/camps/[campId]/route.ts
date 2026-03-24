import { NextRequest, NextResponse } from "next/server";
import {
  assertManagerForClub,
  createAdminClient,
  createCampDayEvent,
  deleteClubEventDeep,
  getCaller,
  localDateTimeInputToIso,
  minutesBetween,
  normalizeText,
  uniq,
} from "@/app/api/camps/_lib";
import type { CampCreateDayInput } from "@/app/api/manager/camps/route";

function uniqIds(values: unknown) {
  return uniq(Array.isArray(values) ? values.map((value) => String(value ?? "").trim()) : []);
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
    const groupIds = uniqIds(body?.group_ids);
    const playerIds = uniqIds(body?.player_ids);
    const coachIds = uniqIds(body?.coach_ids);
    const days = (Array.isArray(body?.days) ? body.days : []) as CampCreateDayInput[];

    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (!headCoachUserId) return NextResponse.json({ error: "head_coach_user_id required" }, { status: 400 });
    if (groupIds.length === 0) return NextResponse.json({ error: "At least one group is required" }, { status: 400 });
    if (playerIds.length === 0) return NextResponse.json({ error: "At least one player is required" }, { status: 400 });
    if (days.length === 0) return NextResponse.json({ error: "At least one day is required" }, { status: 400 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const resolved = await resolveCamp(supabaseAdmin, campId);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

    const managerCheck = await assertManagerForClub(supabaseAdmin, caller.userId, resolved.camp.club_id);
    if ("error" in managerCheck) return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });

    const primaryGroupId = groupIds[0];
    const allCoachIds = uniq([headCoachUserId, ...coachIds]);
    const existingDaysRes = await supabaseAdmin
      .from("club_camp_days")
      .select("event_id,day_index")
      .eq("camp_id", campId)
      .order("day_index", { ascending: true });
    if (existingDaysRes.error) return NextResponse.json({ error: existingDaysRes.error.message }, { status: 400 });

    const existingCampPlayersRes = await supabaseAdmin
      .from("club_camp_players")
      .select("player_id,registration_status,registered_at")
      .eq("camp_id", campId);
    if (existingCampPlayersRes.error) return NextResponse.json({ error: existingCampPlayersRes.error.message }, { status: 400 });

    const existingDayByEventId = new Map<string, { event_id: string; day_index: number }>();
    (existingDaysRes.data ?? []).forEach((row: any) => {
      const eventId = String(row.event_id ?? "").trim();
      if (!eventId) return;
      existingDayByEventId.set(eventId, {
        event_id: eventId,
        day_index: Number(row.day_index ?? 0),
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

    const incomingDayEventIds = uniq(
      days.map((day: any) => normalizeText(day?.event_id)).filter((eventId) => existingDayByEventId.has(eventId))
    );
    const deletedEventIds = Array.from(existingDayByEventId.keys()).filter((eventId) => !incomingDayEventIds.includes(eventId));

    const campUpdateRes = await supabaseAdmin
      .from("club_camps")
      .update({
        title,
        notes,
        head_coach_user_id: headCoachUserId,
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
    const addedPlayerIds = playerIds.filter((playerId) => !existingPlayerById.has(playerId));

    if (removedPlayerIds.length > 0) {
      const deleteCampPlayersRes = await supabaseAdmin
        .from("club_camp_players")
        .delete()
        .eq("camp_id", campId)
        .in("player_id", removedPlayerIds);
      if (deleteCampPlayersRes.error) return NextResponse.json({ error: deleteCampPlayersRes.error.message }, { status: 400 });
    }

    if (addedPlayerIds.length > 0) {
      const insertCampPlayersRes = await supabaseAdmin.from("club_camp_players").insert(
        addedPlayerIds.map((playerId) => ({
          camp_id: campId,
          player_id: playerId,
          registration_status: "invited",
          registered_at: null,
        }))
      );
      if (insertCampPlayersRes.error) return NextResponse.json({ error: insertCampPlayersRes.error.message }, { status: 400 });
    }

    for (const eventId of deletedEventIds) {
      const deleted = await deleteClubEventDeep(supabaseAdmin, eventId);
      if ("error" in deleted) return NextResponse.json({ error: deleted.error }, { status: deleted.status });
    }

    const finalPlayerStatusById: Record<string, string> = {};
    playerIds.forEach((playerId) => {
      finalPlayerStatusById[playerId] = existingPlayerById.get(playerId)?.registration_status ?? "invited";
    });

    const createdDays: Array<{ event_id: string; day_index: number }> = [];
    for (let index = 0; index < days.length; index += 1) {
      const day = days[index] as CampCreateDayInput & { event_id?: string | null };
      const eventId = normalizeText(day?.event_id);
      const startsAt = localDateTimeInputToIso(normalizeText(day?.starts_at));
      const endsAt = localDateTimeInputToIso(normalizeText(day?.ends_at));
      const locationText = normalizeText(day?.location_text) || null;
      const practicalInfo = normalizeText(day?.practical_info) || null;
      const desiredCoachIds = uniq([headCoachUserId, ...allCoachIds, ...uniqIds(day?.coach_ids)]);
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

        if (removedPlayerIds.length > 0) {
          const deleteAttendeesRes = await supabaseAdmin
            .from("club_event_attendees")
            .delete()
            .eq("event_id", eventId)
            .in("player_id", removedPlayerIds);
          if (deleteAttendeesRes.error) return NextResponse.json({ error: deleteAttendeesRes.error.message }, { status: 400 });
        }

        if (addedPlayerIds.length > 0) {
          const insertAttendeesRes = await supabaseAdmin.from("club_event_attendees").insert(
            addedPlayerIds.map((playerId) => ({
              event_id: eventId,
              player_id: playerId,
              status: "not_registered",
            }))
          );
          if (insertAttendeesRes.error) return NextResponse.json({ error: insertAttendeesRes.error.message }, { status: 400 });
        }

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
        headCoachUserId,
        coachIds: desiredCoachIds,
        playerIds,
        attendeeStatusByPlayerId: Object.fromEntries(
          playerIds.map((playerId) => [playerId, finalPlayerStatusById[playerId] === "registered" ? "present" : "not_registered"])
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
