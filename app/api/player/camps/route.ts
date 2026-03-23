import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, resolvePlayerAccess, uniq } from "@/app/api/camps/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "view");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    if (access.clubIds.length === 0) return NextResponse.json({ camps: [], effectiveUserId: access.effectiveUserId });

    const campPlayersRes = await supabaseAdmin
      .from("club_camp_players")
      .select("camp_id,registration_status")
      .eq("player_id", access.effectiveUserId);
    if (campPlayersRes.error) return NextResponse.json({ error: campPlayersRes.error.message }, { status: 400 });

    const campIds = uniq((campPlayersRes.data ?? []).map((row: any) => row.camp_id));
    if (campIds.length === 0) {
      return NextResponse.json({ camps: [], effectiveUserId: access.effectiveUserId });
    }

    const campsRes = await supabaseAdmin
      .from("club_camps")
      .select("id,club_id,title,notes,status,head_coach_user_id,created_at")
      .in("id", campIds)
      .order("created_at", { ascending: false });
    if (campsRes.error) return NextResponse.json({ error: campsRes.error.message }, { status: 400 });

    const camps = campsRes.data ?? [];
    const clubIds = uniq(camps.map((camp: any) => camp.club_id));
    const headCoachIds = uniq(camps.map((camp: any) => camp.head_coach_user_id));

    const [daysRes, attendanceRes, clubsRes, headCoachRes] = await Promise.all([
      campIds.length
        ? supabaseAdmin
            .from("club_camp_days")
            .select("camp_id,event_id,day_index,practical_info,starts_at,ends_at,location_text,club_events:event_id(id,status)")
            .in("camp_id", campIds)
            .order("day_index", { ascending: true })
        : ({ data: [], error: null } as const),
      campIds.length
        ? supabaseAdmin
            .from("club_event_attendees")
            .select("event_id,status")
            .eq("player_id", access.effectiveUserId)
        : ({ data: [], error: null } as const),
      clubIds.length ? supabaseAdmin.from("clubs").select("id,name").in("id", clubIds) : ({ data: [], error: null } as const),
      headCoachIds.length
        ? supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", headCoachIds)
        : ({ data: [], error: null } as const),
    ]);
    if (daysRes.error) return NextResponse.json({ error: daysRes.error.message }, { status: 400 });
    if (attendanceRes.error) return NextResponse.json({ error: attendanceRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (headCoachRes.error) return NextResponse.json({ error: headCoachRes.error.message }, { status: 400 });

    const eventIds = uniq((daysRes.data ?? []).map((row: any) => row.event_id));
    const participantAttendanceRes = eventIds.length
      ? await supabaseAdmin
          .from("club_event_attendees")
          .select("event_id,player_id,status")
          .in("event_id", eventIds)
          .eq("status", "present")
      : ({ data: [], error: null } as const);
    if (participantAttendanceRes.error) {
      return NextResponse.json({ error: participantAttendanceRes.error.message }, { status: 400 });
    }

    const participantIds = uniq((participantAttendanceRes.data ?? []).map((row: any) => row.player_id));
    const participantProfilesRes = participantIds.length
      ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", participantIds)
      : ({ data: [], error: null } as const);
    if (participantProfilesRes.error) {
      return NextResponse.json({ error: participantProfilesRes.error.message }, { status: 400 });
    }

    const registrationByCampId: Record<string, string> = {};
    (campPlayersRes.data ?? []).forEach((row: any) => {
      registrationByCampId[String(row.camp_id)] = String(row.registration_status ?? "invited");
    });

    const attendanceByEventId: Record<string, string> = {};
    (attendanceRes.data ?? []).forEach((row: any) => {
      const eventId = String(row.event_id ?? "").trim();
      if (!eventId) return;
      attendanceByEventId[eventId] = String(row.status ?? "not_registered");
    });

    const clubNameById = new Map<string, string>();
    (clubsRes.data ?? []).forEach((club: any) => clubNameById.set(String(club.id), String(club.name ?? "Club")));
    const headCoachById = new Map<string, any>();
    (headCoachRes.data ?? []).forEach((profile: any) => headCoachById.set(String(profile.id), profile));
    const participantProfileById = new Map<string, any>();
    (participantProfilesRes.data ?? []).forEach((profile: any) => participantProfileById.set(String(profile.id), profile));
    const participantsByEventId: Record<string, any[]> = {};
    (participantAttendanceRes.data ?? []).forEach((row: any) => {
      const eventId = String(row.event_id ?? "").trim();
      const playerId = String(row.player_id ?? "").trim();
      if (!eventId || !playerId) return;
      if (!participantsByEventId[eventId]) participantsByEventId[eventId] = [];
      const profile = participantProfileById.get(playerId);
      if (profile) participantsByEventId[eventId].push(profile);
    });

    const daysByCampId: Record<string, any[]> = {};
    (daysRes.data ?? []).forEach((row: any) => {
      const campId = String(row.camp_id ?? "").trim();
      const eventId = String(row.event_id ?? "").trim();
      if (!campId || !eventId) return;
      if (!daysByCampId[campId]) daysByCampId[campId] = [];
      daysByCampId[campId].push({
        event_id: eventId,
        day_index: Number(row.day_index ?? 0),
        practical_info: row.practical_info ?? null,
        starts_at: row.starts_at ?? null,
        ends_at: row.ends_at ?? null,
        location_text: row.location_text ?? null,
        status: row.club_events?.status ?? "scheduled",
        attendance_status: attendanceByEventId[eventId] ?? "not_registered",
        participants_count: (participantsByEventId[eventId] ?? []).length,
        participants: participantsByEventId[eventId] ?? [],
      });
    });

    return NextResponse.json({
      effectiveUserId: access.effectiveUserId,
      camps: camps.map((camp: any) => ({
        ...camp,
        club_name: clubNameById.get(String(camp.club_id ?? "").trim()) ?? "Club",
        head_coach: headCoachById.get(String(camp.head_coach_user_id ?? "").trim()) ?? null,
        registration_status: registrationByCampId[String(camp.id)] ?? "invited",
        days: (daysByCampId[String(camp.id)] ?? []).sort((a, b) => a.day_index - b.day_index),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
