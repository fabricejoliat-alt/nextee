import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

type AttendanceStatus = "expected" | "present" | "absent" | "excused" | "not_registered";

type AttendeeRow = {
  event_id: string | null;
  status: AttendanceStatus | null;
};

type TrainingSessionRow = {
  id: string | null;
  start_at: string | null;
  location_text: string | null;
  session_type: string | null;
  club_id: string | null;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  created_at: string | null;
  club_event_id: string | null;
};

type ClubEventRow = {
  id: string | null;
  event_type: string | null;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number | null;
  location_text: string | null;
  club_id: string | null;
  group_id: string | null;
  series_id: string | null;
  status: string | null;
  requires_evaluation: boolean | null;
  competition_level: string | null;
  competition_category: string | null;
  external_registration_url: string | null;
  competition_note: string | null;
};

type CampDayRow = {
  session_id: string | null;
  camp_id: string | null;
  day_index: number | null;
  starts_at: string | null;
  ends_at: string | null;
  location_text: string | null;
};

type CampRow = {
  id: string | null;
  title: string | null;
  coach_name: string | null;
  notes: string | null;
  status: string | null;
};

type ClubCampDayLinkRow = {
  event_id: string | null;
  camp_id: string | null;
};

type ClubCampStatusRow = {
  id: string | null;
  status: string | null;
};

type SessionCampMeta = {
  player_camp_id: string;
  player_camp_title: string | null;
  player_camp_coach_name: string | null;
  player_camp_notes: string | null;
  player_camp_day_index: number;
  player_camp_starts_at: string | null;
  player_camp_ends_at: string | null;
  player_camp_location_text: string | null;
};

type NamedRow = { id: string | null; name: string | null };
type MembershipRow = { club_id: string | null };

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

export async function GET(req: NextRequest) {
  try {
    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedOrganizationId: requestedOrganizationId(req.url),
      requestedPlayerId: childId,
      mode: "view",
    });
    const { supabaseAdmin } = access;
    const viewerUserId = access.actorUserId;
    const effectiveUserId = access.subjectPlayerId;

    const [perfRes, profileRes, activeMembershipsRes, sessionsRes, attendeeRes, competitionRes] = await Promise.all([
      supabaseAdmin
        .from("club_members")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("role", "player")
        .eq("is_active", true)
        .eq("is_performance", true)
        .limit(1),
      supabaseAdmin
        .from("profiles")
        .select("first_name,last_name")
        .eq("id", effectiveUserId)
        .maybeSingle(),
      supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", effectiveUserId)
        .in("club_id", access.organizationIds)
        .eq("is_active", true),
      supabaseAdmin
        .from("training_sessions")
        .select("id,start_at,location_text,session_type,club_id,total_minutes,motivation,difficulty,satisfaction,created_at,club_event_id")
        .eq("user_id", effectiveUserId)
        .or(personalOrOrganizationFilter("club_id", access.organizationIds))
        .order("start_at", { ascending: false }),
      supabaseAdmin
        .from("club_event_attendees")
        .select("event_id,status")
        .eq("player_id", effectiveUserId),
      supabaseAdmin
        .from("player_activity_events")
        .select("id,user_id,event_type,title,starts_at,ends_at,location_text,notes,status,created_at")
        .eq("user_id", effectiveUserId).or(personalOrOrganizationFilter("organization_id", access.organizationIds))
        .order("starts_at", { ascending: false }),
    ]);

    if (perfRes.error) return NextResponse.json({ error: perfRes.error.message }, { status: 400 });
    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });
    if (activeMembershipsRes.error) return NextResponse.json({ error: activeMembershipsRes.error.message }, { status: 400 });
    if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error.message }, { status: 400 });
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (competitionRes.error) return NextResponse.json({ error: competitionRes.error.message }, { status: 400 });

    const sessions = (sessionsRes.data ?? []) as TrainingSessionRow[];
    const attendeeRows = (attendeeRes.data ?? []) as AttendeeRow[];
    const eventIds = uniq(attendeeRows.map((row) => row.event_id));
    const attendeeStatusByEventId: Record<string, AttendanceStatus | null> = {};
    attendeeRows.forEach((row) => {
      attendeeStatusByEventId[String(row.event_id)] = row.status ?? null;
    });

    const eventsRes = eventIds.length
      ? await supabaseAdmin
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,series_id,status,requires_evaluation,competition_level,competition_category,external_registration_url,competition_note")
          .in("id", eventIds).in("club_id", access.organizationIds)
          .order("starts_at", { ascending: false })
      : { data: [] as ClubEventRow[], error: null };
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    const rawAttendeeEvents = (eventsRes.data ?? []) as ClubEventRow[];
    for (const key of Object.keys(attendeeStatusByEventId)) if (!rawAttendeeEvents.some(event => event.id === key)) delete attendeeStatusByEventId[key];
    const campEventIds = uniq(
      rawAttendeeEvents
        .filter((event) => event.event_type === "camp")
        .map((event) => event.id),
    );
    const clubCampDaysRes = campEventIds.length
      ? await supabaseAdmin
          .from("club_camp_days")
          .select("event_id,camp_id")
          .in("event_id", campEventIds)
      : { data: [] as ClubCampDayLinkRow[], error: null };
    if (clubCampDaysRes.error) return NextResponse.json({ error: clubCampDaysRes.error.message }, { status: 400 });

    const clubCampDayLinks = (clubCampDaysRes.data ?? []) as ClubCampDayLinkRow[];
    const linkedClubCampIds = uniq(clubCampDayLinks.map((row) => row.camp_id));
    const clubCampStatusesRes = linkedClubCampIds.length
      ? await supabaseAdmin.from("club_camps").select("id,status").in("id", linkedClubCampIds)
      : { data: [] as ClubCampStatusRow[], error: null };
    if (clubCampStatusesRes.error) return NextResponse.json({ error: clubCampStatusesRes.error.message }, { status: 400 });

    const visibleClubCampIds = new Set(
      ((clubCampStatusesRes.data ?? []) as ClubCampStatusRow[])
        .filter((camp) => camp.status === "scheduled")
        .map((camp) => String(camp.id ?? "").trim())
        .filter(Boolean),
    );
    const hiddenCampEventIds = new Set(
      clubCampDayLinks
        .filter((row) => !visibleClubCampIds.has(String(row.camp_id ?? "").trim()))
        .map((row) => String(row.event_id ?? "").trim())
        .filter(Boolean),
    );
    const attendeeEvents = rawAttendeeEvents.filter(
      (event) => event.event_type !== "camp" || !hiddenCampEventIds.has(String(event.id ?? "").trim()),
    );

    const sessionIds = uniq(sessions.map((row) => row.id));
    const campDaysRes = sessionIds.length
      ? await supabaseAdmin
          .from("player_camp_days")
          .select("session_id,camp_id,day_index,starts_at,ends_at,location_text")
          .in("session_id", sessionIds)
      : { data: [] as CampDayRow[], error: null };
    if (campDaysRes.error) return NextResponse.json({ error: campDaysRes.error.message }, { status: 400 });
    const campDays = (campDaysRes.data ?? []) as CampDayRow[];

    const campIds = uniq(campDays.map((row) => row.camp_id));
    const campsRes = campIds.length
      ? await supabaseAdmin.from("player_camps").select("id,title,coach_name,notes,status").in("id", campIds).or(personalOrOrganizationFilter("organization_id", access.organizationIds))
      : { data: [] as CampRow[], error: null };
    if (campsRes.error) return NextResponse.json({ error: campsRes.error.message }, { status: 400 });
    const camps = (campsRes.data ?? []) as CampRow[];

    const campById: Record<string, CampRow> = {};
    camps.forEach((row) => {
      const id = String(row.id ?? "").trim();
      if (id) campById[id] = row;
    });

    const sessionCampMetaBySessionId: Record<string, SessionCampMeta> = {};
    campDays.forEach((row) => {
      const sessionId = String(row.session_id ?? "").trim();
      const campId = String(row.camp_id ?? "").trim();
      if (!sessionId || !campId) return;
      const camp = campById[campId] ?? null;
      sessionCampMetaBySessionId[sessionId] = {
        player_camp_id: campId,
        player_camp_title: String(camp?.title ?? "").trim() || null,
        player_camp_coach_name: String(camp?.coach_name ?? "").trim() || null,
        player_camp_notes: String(camp?.notes ?? "").trim() || null,
        player_camp_day_index: Number(row.day_index ?? 0),
        player_camp_starts_at: row.starts_at ?? null,
        player_camp_ends_at: row.ends_at ?? null,
        player_camp_location_text: row.location_text ?? null,
      };
    });

    const enrichedSessions = sessions.map((session) => ({
      ...session,
      ...(sessionCampMetaBySessionId[String(session.id ?? "").trim()] ?? {}),
    }));

    const clubIds = uniq([
      ...enrichedSessions.map((session) => session.club_id),
      ...attendeeEvents.map((event) => event.club_id),
    ]);
    const groupIds = uniq(attendeeEvents.map((event) => event.group_id));

    const [clubsRes, groupsRes] = await Promise.all([
      clubIds.length
        ? supabaseAdmin.from("organizations").select("id,name").in("id", clubIds)
        : { data: [] as NamedRow[], error: null },
      groupIds.length
        ? supabaseAdmin.from("coach_groups").select("id,name").in("id", groupIds)
        : { data: [] as NamedRow[], error: null },
    ]);
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });

    const clubNameById: Record<string, string> = {};
    ((clubsRes.data ?? []) as NamedRow[]).forEach((club) => {
      clubNameById[String(club.id)] = String(club.name ?? "Club");
    });

    const groupNameById: Record<string, string> = {};
    ((groupsRes.data ?? []) as NamedRow[]).forEach((group) => {
      groupNameById[String(group.id)] = String(group.name ?? "Groupe");
    });

    const fullName = `${String(profileRes.data?.first_name ?? "").trim()} ${String(profileRes.data?.last_name ?? "").trim()}`.trim();

    return NextResponse.json({
      viewerUserId,
      effectiveUserId,
      effectivePlayerName: fullName || "Joueur",
      performanceEnabled: (perfRes.data ?? []).length > 0,
      sessions: enrichedSessions,
      attendeeEvents,
      attendeeStatusByEventId,
      competitionEvents: competitionRes.data ?? [],
      activeClubCount: uniq(((activeMembershipsRes.data ?? []) as MembershipRow[]).map((row) => row.club_id)).length,
      clubNameById,
      groupNameById,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error) }
    );
  }
}
