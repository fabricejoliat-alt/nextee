import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

import { createRequestTiming } from "@/lib/server/requestTiming";
import { readRelatedRows } from "@/lib/server/paginatedRead";
import { legalNoStore } from "@/lib/server/legalAccess";
import { canChangePastTrainingAttendance } from "@/lib/playerTrainingAttendanceChange";
import { coachEventEndMs } from "@/lib/coachCalendar";

type AttendanceStatus = "expected" | "present" | "absent" | "excused" | "not_registered";

type AttendeeRow = {
  event_id: string | null;
  status: AttendanceStatus | null;
  coach_recorded_status: string | null;
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

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

export async function GET(req: NextRequest) {
  const timing = createRequestTiming();
  try {
    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const access = await timing.measure("access", () => resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedOrganizationId: requestedOrganizationId(req.url),
      requestedPlayerId: childId,
      mode: "view",
    }));
    const { supabaseAdmin } = access;
    const viewerUserId = access.actorUserId;
    const effectiveUserId = access.subjectPlayerId;

    const [perfRes, profileRes, clubsRes, sessionsRes, attendeeRes, competitionRes] = await timing.measure("base", () => Promise.all([
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
      supabaseAdmin.from("organizations").select("id,name").in("id", access.organizationIds),
      supabaseAdmin
        .from("training_sessions")
        .select("id,start_at,location_text,session_type,club_id,total_minutes,motivation,difficulty,satisfaction,created_at,club_event_id")
        .eq("user_id", effectiveUserId)
        .or(personalOrOrganizationFilter("club_id", access.organizationIds))
        .order("start_at", { ascending: false }),
      supabaseAdmin
        .from("club_event_attendees")
        .select("event_id,status,coach_recorded_status")
        .eq("player_id", effectiveUserId),
      supabaseAdmin
        .from("player_activity_events")
        .select("id,user_id,event_type,title,starts_at,ends_at,location_text,notes,status,created_at")
        .eq("user_id", effectiveUserId).or(personalOrOrganizationFilter("organization_id", access.organizationIds))
        .order("starts_at", { ascending: false }),
    ]));

    if (perfRes.error) return NextResponse.json({ error: perfRes.error.message }, { status: 400 });
    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
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

    const sessionIds = uniq(sessions.map(row => row.id));
    const [eventsRes, campDaysRes, items] = await timing.measure("related", () => Promise.all([      eventIds.length
      ? supabaseAdmin
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,series_id,status,requires_evaluation,competition_level,competition_category,external_registration_url,competition_note")
          .in("id", eventIds).in("club_id", access.organizationIds)
          .order("starts_at", { ascending: false })
      : { data: [] as ClubEventRow[], error: null },      sessionIds.length
      ? supabaseAdmin
          .from("player_camp_days")
          .select("session_id,camp_id,day_index,starts_at,ends_at,location_text")
          .in("session_id", sessionIds)
      : { data: [] as CampDayRow[], error: null },
      readRelatedRows<{ session_id: string; minutes: number }>(sessionIds, (ids, from, to) => supabaseAdmin
        .from("training_session_items").select("session_id,minutes").in("session_id", ids).order("id").range(from, to)),
    ]));
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    const rawAttendeeEvents = (eventsRes.data ?? []) as ClubEventRow[];
    for (const key of Object.keys(attendeeStatusByEventId)) if (!rawAttendeeEvents.some(event => event.id === key)) delete attendeeStatusByEventId[key];
    const campEventIds = uniq(
      rawAttendeeEvents
        .filter((event) => event.event_type === "camp")
        .map((event) => event.id),
    );
    const campIds = uniq((campDaysRes.data ?? []).map(row => row.camp_id));
    const groupIds = uniq(rawAttendeeEvents.map(row => row.group_id));
    const [clubCampDaysRes, campsRes, groupsRes] = await timing.measure("metadata", () => Promise.all([
      campEventIds.length
      ? supabaseAdmin
          .from("club_camp_days")
          .select("event_id,camp_id")
          .in("event_id", campEventIds)
      : { data: [] as ClubCampDayLinkRow[], error: null },
      campIds.length ? supabaseAdmin.from("player_camps").select("id,title,coach_name,notes,status")
        .in("id", campIds).or(personalOrOrganizationFilter("organization_id", access.organizationIds)) : { data: [] as CampRow[], error: null },
      groupIds.length ? supabaseAdmin.from("coach_groups").select("id,name").in("id", groupIds).in("club_id", access.organizationIds)
        : { data: [] as NamedRow[], error: null },
    ]));
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

    const now = new Date();
    const pastTrainingEvents = attendeeEvents.filter((event) => event.id && event.starts_at && event.event_type === "training"
      && event.status === "scheduled" && coachEventEndMs({ starts_at: event.starts_at, ends_at: event.ends_at, duration_minutes: event.duration_minutes }) < now.getTime());
    const pastTrainingIds = pastTrainingEvents.map((event) => String(event.id));
    const [feedbackRows, responseRows] = await timing.measure("attendance_eligibility", () => Promise.all([
      readRelatedRows<{ event_id: string }>(pastTrainingIds, (ids, from, to) => supabaseAdmin
        .from("club_event_coach_feedback").select("event_id").eq("player_id", effectiveUserId)
        .in("event_id", ids).order("event_id").order("coach_id").range(from, to)),
      readRelatedRows<{ event_id: string; respondent_role: string }>(pastTrainingIds, (ids, from, to) => supabaseAdmin
        .from("club_event_evaluation_responses").select("event_id,respondent_role").eq("player_id", effectiveUserId)
        .in("event_id", ids).in("respondent_role", ["coach", "player"]).order("event_id").order("id").range(from, to)),
    ]));
    const feedbackEventIds = new Set(feedbackRows.map((row) => row.event_id));
    const coachResponseEventIds = new Set(responseRows.filter((row) => row.respondent_role === "coach").map((row) => row.event_id));
    const playerResponseEventIds = new Set(responseRows.filter((row) => row.respondent_role === "player").map((row) => row.event_id));
    const attendeeByEventId = new Map(attendeeRows.map((row) => [String(row.event_id), row]));
    const sessionsByEventId = new Map<string, TrainingSessionRow[]>();
    sessions.forEach((session) => { if (session.club_event_id) sessionsByEventId.set(session.club_event_id, [...(sessionsByEventId.get(session.club_event_id) ?? []), session]); });
    const attendanceChangeableEventIds = access.permissions.edit ? pastTrainingEvents.filter((event) => canChangePastTrainingAttendance({
      eventType: event.event_type,
      eventStatus: event.status,
      eventStartsAt: String(event.starts_at),
      eventEndsAt: event.ends_at,
      eventDurationMinutes: event.duration_minutes,
      coachRecordedStatus: attendeeByEventId.get(String(event.id))?.coach_recorded_status ?? null,
      coachFeedbackRecorded: feedbackEventIds.has(String(event.id)),
      coachResponseRecorded: coachResponseEventIds.has(String(event.id)),
      playerRatings: (sessionsByEventId.get(String(event.id)) ?? []).flatMap((session) => [session.motivation, session.difficulty, session.satisfaction]),
      playerResponseRecorded: playerResponseEventIds.has(String(event.id)),
    }, now)).map((event) => String(event.id)) : [];

    if (campDaysRes.error) return NextResponse.json({ error: campDaysRes.error.message }, { status: 400 });
    const campDays = (campDaysRes.data ?? []) as CampDayRow[];

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

    const withContent = new Set(items.filter(item => Number(item.minutes) > 0).map(item => item.session_id));
    return NextResponse.json({
      viewerUserId,
      effectiveUserId,
      effectivePlayerName: fullName || "Joueur",
      performanceEnabled: (perfRes.data ?? []).length > 0,
      sessions: enrichedSessions,
      attendeeEvents,
      attendeeStatusByEventId,
      attendanceChangeableEventIds,
      competitionEvents: competitionRes.data ?? [],
      activeClubCount: access.organizationIds.length,
      completedSessionIds: sessions.filter(row => withContent.has(String(row.id))
        && [row.motivation,row.difficulty,row.satisfaction].every(value => typeof value === "number")).map(row => row.id),
      clubNameById,
      groupNameById,
    }, { headers: { ...legalNoStore, ...timing.headers() } });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error), headers: { ...legalNoStore, ...timing.headers() } }
    );
  }
}
