import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, getCaller, resolveCoachClubIds, uniq } from "@/app/api/camps/_lib";

function normalizeRegistrationStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["invited", "registered", "declined"].includes(normalized) ? normalized : "invited";
}

function fullNameSort(
  a?: { first_name: string | null; last_name: string | null } | null,
  b?: { first_name: string | null; last_name: string | null } | null
) {
  const aName = `${a?.first_name ?? ""} ${a?.last_name ?? ""}`.trim();
  const bName = `${b?.first_name ?? ""} ${b?.last_name ?? ""}`.trim();
  return aName.localeCompare(bName, "fr");
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createAdminClient();
    const caller = await getCaller(supabaseAdmin, accessToken);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const access = await resolveCoachClubIds(supabaseAdmin, caller.userId);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    if (access.clubIds.length === 0) return NextResponse.json({ camps: [] });

    const campsRes = await supabaseAdmin
      .from("club_camps")
      .select("id,club_id,title,notes,status,head_coach_user_id,created_at")
      .in("club_id", access.clubIds)
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
      if (!campId) return;
      dayIndexByEventId[String(row.event_id ?? "").trim()] = Number(row.day_index ?? 0);
      if (!daysByCampId[campId]) daysByCampId[campId] = [];
      daysByCampId[campId].push({
        event_id: String(row.event_id ?? ""),
        day_index: Number(row.day_index ?? 0),
        practical_info: row.practical_info ?? null,
        starts_at: row.starts_at ?? null,
        ends_at: row.ends_at ?? null,
        location_text: row.location_text ?? null,
        status: row.club_events?.status ?? "scheduled",
        group_id: String(row.club_events?.group_id ?? ""),
        counts: { present: 0, not_registered: 0, absent: 0, excused: 0 },
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
      const registration = {
        player_id: playerId,
        registration_status: normalizeRegistrationStatus(row.registration_status),
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
    Object.values(availablePlayersByClubId).forEach((players) => {
      players.sort((a, b) => fullNameSort(a, b));
    });

    const dayByEventId = new Map<string, any>();
    Object.values(daysByCampId).forEach((days) => {
      days.forEach((day) => dayByEventId.set(String(day.event_id), day));
    });

    const eventIds = Array.from(dayByEventId.keys());
    if (eventIds.length > 0) {
      const attendeesRes = await supabaseAdmin
        .from("club_event_attendees")
        .select("event_id,player_id,status")
        .in("event_id", eventIds);
      if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });

      const participantIds = uniq(
        (attendeesRes.data ?? [])
          .filter((attendee: any) => String(attendee.status ?? "not_registered") === "present")
          .map((attendee: any) => String(attendee.player_id ?? "").trim())
      );
      const participantProfilesRes = participantIds.length
        ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", participantIds)
        : ({ data: [], error: null } as const);
      if (participantProfilesRes.error) return NextResponse.json({ error: participantProfilesRes.error.message }, { status: 400 });

      const participantById = new Map<string, any>();
      (participantProfilesRes.data ?? []).forEach((profile: any) => {
        participantById.set(String(profile.id ?? "").trim(), profile);
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

        if (status === "present") {
          const playerId = String(attendee.player_id ?? "").trim();
          const participant = participantById.get(playerId);
          if (participant) {
            day.participants.push({
              id: playerId,
              first_name: participant.first_name ?? null,
              last_name: participant.last_name ?? null,
              avatar_url: participant.avatar_url ?? null,
            });
          }
        }

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
          day.participants.sort((a: any, b: any) => {
            const aName = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
            const bName = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();
            return aName.localeCompare(bName, "fr");
          });
        });
      });
    }

    return NextResponse.json({
      camps: camps.map((camp: any) => ({
        ...camp,
        club_name: clubNameById.get(String(camp.club_id ?? "").trim()) ?? "Club",
        head_coach: headCoachById.get(String(camp.head_coach_user_id ?? "").trim()) ?? null,
        available_players: availablePlayersByClubId[String(camp.club_id ?? "").trim()] ?? [],
        player_registrations: (playerRegistrationsByCampId[String(camp.id)] ?? []).sort((a, b) => {
          return fullNameSort(a.player, b.player);
        }),
        days: (daysByCampId[String(camp.id)] ?? []).sort((a, b) => a.day_index - b.day_index),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
