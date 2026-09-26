import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

type AttendanceStatus = "expected" | "present" | "absent" | "excused";

type AttendeeRow = { event_id: string | null; status: AttendanceStatus | null };
type RegisteredCampPlayerRow = { camp_id: string | null };
type FutureSessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  session_type: string | null;
  club_id: string | null;
  club_event_id: string | null;
};
type PlannedCompetitionRow = {
  id: string;
  event_type: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: string | null;
};
type ClubEventRow = {
  id: string;
  event_type: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  location_text: string | null;
  club_id: string | null;
  group_id: string | null;
  status: string | null;
  competition_level?: string | null;
  competition_category?: string | null;
  external_registration_url?: string | null;
  competition_note?: string | null;
};
type RegisteredCampDayRow = {
  camp_id: string | null;
  event_id: string | null;
  starts_at: string | null;
  club_events: ClubEventRow[] | null;
};
type NamedRow = { id: string | null; name: string | null };
type StructureRow = { event_id: string | null; category: string | null; minutes: number | null; note: string | null };
type EventCoachRow = { event_id: string | null; coach_id: string | null };
type CoachProfileRow = { id: string | null; first_name: string | null; last_name: string | null };

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

export async function GET(req: NextRequest) {
  try {
    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: childId,
      mode: "view",
    });
    const { supabaseAdmin } = access;
    const viewerUserId = access.actorUserId;
    const effectiveUserId = access.subjectPlayerId;

    const nowIso = new Date().toISOString();

    const [futureSessionsRes, attendeeRes, plannedCompetitionsRes, registeredCampPlayersRes] = await Promise.all([
      supabaseAdmin
        .from("training_sessions")
        .select("id,start_at,location_text,session_type,club_id,club_event_id")
        .eq("user_id", effectiveUserId)
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(5),
      supabaseAdmin
        .from("club_event_attendees")
        .select("event_id,status")
        .eq("player_id", effectiveUserId)
        .in("status", ["expected", "present", "absent", "excused"]),
      supabaseAdmin
        .from("player_activity_events")
        .select("id,event_type,title,starts_at,ends_at,location_text,status")
        .eq("user_id", effectiveUserId)
        .eq("status", "scheduled")
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(5),
      supabaseAdmin
        .from("club_camp_players")
        .select("camp_id")
        .eq("player_id", effectiveUserId)
        .eq("registration_status", "registered"),
    ]);

    if (futureSessionsRes.error) return NextResponse.json({ error: futureSessionsRes.error.message }, { status: 400 });
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (plannedCompetitionsRes.error) return NextResponse.json({ error: plannedCompetitionsRes.error.message }, { status: 400 });
    if (registeredCampPlayersRes.error) return NextResponse.json({ error: registeredCampPlayersRes.error.message }, { status: 400 });

    const futureSessions = (futureSessionsRes.data ?? []) as FutureSessionRow[];
    const attendeeRows = (attendeeRes.data ?? []) as AttendeeRow[];
    const plannedCompetitions = (plannedCompetitionsRes.data ?? []) as PlannedCompetitionRow[];
    const registeredCampIds = uniq(
      ((registeredCampPlayersRes.data ?? []) as RegisteredCampPlayerRow[]).map((row) => row.camp_id)
    );

    const attendeeStatusByEventId: Record<string, AttendanceStatus | null> = {};
    const attendeeEventIds = uniq(attendeeRows.map((row) => row.event_id));
    attendeeRows.forEach((row) => {
      const eventId = String(row.event_id ?? "").trim();
      if (!eventId) return;
      attendeeStatusByEventId[eventId] = (row.status ?? null) as "expected" | "present" | "absent" | "excused" | null;
    });

    const registeredCampDaysRes = registeredCampIds.length
      ? await supabaseAdmin
          .from("club_camp_days")
          .select("camp_id,event_id,starts_at,club_events:event_id(id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,status,competition_level,competition_category,external_registration_url,competition_note)")
          .in("camp_id", registeredCampIds)
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
      : { data: [] as RegisteredCampDayRow[], error: null };
    if (registeredCampDaysRes.error) return NextResponse.json({ error: registeredCampDaysRes.error.message }, { status: 400 });

    const registeredCampDays = (registeredCampDaysRes.data ?? []) as RegisteredCampDayRow[];
    const registeredCampEventIds = uniq(registeredCampDays.map((row) => row.event_id));
    const registeredCampEvents = registeredCampDays
      .flatMap((row) => row.club_events ?? [])
      .filter((event) => String(event.status ?? "") === "scheduled")
      .map((event): ClubEventRow => ({
        id: String(event.id ?? "").trim(),
        event_type: event.event_type ?? null,
        title: event.title ?? null,
        starts_at: event.starts_at ?? null,
        ends_at: event.ends_at ?? null,
        duration_minutes: Number(event.duration_minutes ?? 0),
        location_text: event.location_text ?? null,
        club_id: String(event.club_id ?? "").trim(),
        group_id: event.group_id ? String(event.group_id).trim() : null,
        status: (event.status ?? "scheduled") as "scheduled" | "cancelled",
      }))
      .filter((event) => event.id && event.starts_at);
    const plannedEventIds = uniq([...attendeeEventIds, ...registeredCampEventIds]);
    const plannedRes = plannedEventIds.length
      ? await supabaseAdmin
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,status,competition_level,competition_category,external_registration_url,competition_note")
          .in("id", plannedEventIds)
          .eq("status", "scheduled")
          .or(`starts_at.gte.${nowIso},and(event_type.eq.competition,ends_at.gte.${nowIso})`)
          .order("starts_at", { ascending: true })
      : ({ data: [], error: null } as const);
    if (plannedRes.error) return NextResponse.json({ error: plannedRes.error.message }, { status: 400 });
    const plannedEventsMap = new Map<string, ClubEventRow>();
    ((plannedRes.data ?? []) as ClubEventRow[]).forEach((event) => {
      const eventId = String(event.id ?? "").trim();
      if (!eventId) return;
      plannedEventsMap.set(eventId, event);
    });
    registeredCampEvents.forEach((event) => {
      if (!plannedEventsMap.has(event.id)) plannedEventsMap.set(event.id, event);
    });
    const plannedEvents = Array.from(plannedEventsMap.values()).sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

    const plannedEventIdSet = new Set(plannedEvents.map((event) => String(event.id ?? "").trim()).filter(Boolean));
    const dedupedFutureSessions = futureSessions.filter((session) => {
      const linkedEventId = String(session.club_event_id ?? "").trim();
      return !linkedEventId || !plannedEventIdSet.has(linkedEventId);
    });

    const clubIds = uniq([
      ...plannedEvents.map((event) => event.club_id),
      ...dedupedFutureSessions.map((session) => session.club_id),
    ]);
    const groupIds = uniq(plannedEvents.map((event) => event.group_id));
    const structureEventIds = uniq([
      ...plannedEvents.map((event) => event.id),
      ...futureSessions.map((session) => session.club_event_id),
    ]);
    const coachEventIds = structureEventIds;

    const [clubsRes, groupsRes, structureRes, eventCoachesRes] = await Promise.all([
      clubIds.length ? supabaseAdmin.from("clubs").select("id,name").in("id", clubIds) : ({ data: [], error: null } as const),
      groupIds.length ? supabaseAdmin.from("coach_groups").select("id,name").in("id", groupIds) : ({ data: [], error: null } as const),
      structureEventIds.length
        ? supabaseAdmin.from("club_event_structure_items").select("event_id,category,minutes,note").in("event_id", structureEventIds)
        : ({ data: [], error: null } as const),
      coachEventIds.length
        ? supabaseAdmin.from("club_event_coaches").select("event_id,coach_id").in("event_id", coachEventIds)
        : ({ data: [], error: null } as const),
    ]);
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (structureRes.error) return NextResponse.json({ error: structureRes.error.message }, { status: 400 });
    if (eventCoachesRes.error) return NextResponse.json({ error: eventCoachesRes.error.message }, { status: 400 });

    const eventCoaches = (eventCoachesRes.data ?? []) as EventCoachRow[];
    const coachIds = uniq(eventCoaches.map((row) => row.coach_id));
    const coachProfilesRes = coachIds.length
      ? await supabaseAdmin.from("profiles").select("id,first_name,last_name").in("id", coachIds)
      : ({ data: [], error: null } as const);
    if (coachProfilesRes.error) return NextResponse.json({ error: coachProfilesRes.error.message }, { status: 400 });

    const clubNameById: Record<string, string> = {};
    ((clubsRes.data ?? []) as NamedRow[]).forEach((club) => {
      const id = String(club.id ?? "").trim();
      if (!id) return;
      clubNameById[id] = String(club.name ?? "Club");
    });

    const groupNameById: Record<string, string> = {};
    ((groupsRes.data ?? []) as NamedRow[]).forEach((group) => {
      const id = String(group.id ?? "").trim();
      if (!id) return;
      groupNameById[id] = String(group.name ?? "Groupe");
    });

    const eventStructureByEventId: Record<string, Array<{ event_id: string; category: string; minutes: number; note: string | null }>> = {};
    ((structureRes.data ?? []) as StructureRow[]).forEach((item) => {
      const eventId = String(item.event_id ?? "").trim();
      if (!eventId) return;
      if (!eventStructureByEventId[eventId]) eventStructureByEventId[eventId] = [];
      eventStructureByEventId[eventId].push({
        event_id: eventId,
        category: String(item.category ?? ""),
        minutes: Number(item.minutes ?? 0),
        note: item.note ?? null,
      });
    });

    const coachNameById = new Map(
      ((coachProfilesRes.data ?? []) as CoachProfileRow[]).map((profile) => {
        const name = [profile.first_name, profile.last_name].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
        return [String(profile.id ?? "").trim(), name] as const;
      })
    );
    const coachNamesByEventId: Record<string, string[]> = {};
    eventCoaches.forEach((row) => {
      const eventId = String(row.event_id ?? "").trim();
      const coachName = coachNameById.get(String(row.coach_id ?? "").trim()) ?? "";
      if (!eventId || !coachName) return;
      const names = coachNamesByEventId[eventId] ?? [];
      if (!names.includes(coachName)) names.push(coachName);
      coachNamesByEventId[eventId] = names;
    });

    const upcomingCampEventIds = new Set(
      plannedEvents
        .filter((event) => String(event.event_type ?? "").trim() === "camp")
        .map((event) => String(event.id ?? "").trim())
        .filter(Boolean)
    );

    const upcomingActivities = [
      ...plannedEvents.map((event) => ({ kind: "event", key: `event-${event.id}`, dateIso: event.starts_at, event })),
      ...dedupedFutureSessions.map((session) => ({
        kind: "session",
        key: `session-${session.id}`,
        dateIso: session.start_at,
        session,
      })),
      ...plannedCompetitions
        .filter((competition) => !(competition.event_type === "camp" && upcomingCampEventIds.size > 0))
        .map((competition) => ({
          kind: "competition",
          key: `competition-${competition.id}`,
          dateIso: competition.starts_at,
          competition,
        })),
    ]
      .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());

    return NextResponse.json({
      viewerUserId,
      effectiveUserId,
      attendeeStatusByEventId,
      clubNameById,
      groupNameById,
      coachNamesByEventId,
      eventStructureByEventId,
      upcomingActivities,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error) }
    );
  }
}
