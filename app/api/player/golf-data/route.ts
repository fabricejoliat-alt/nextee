import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenFromRequest, playerAccessErrorStatus, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";
import { canReadPlayerHistory } from "@/lib/server/personalHistoryAccess";
import { legalNoStore } from "@/lib/server/legalAccess";
import { createRequestTiming } from "@/lib/server/requestTiming";
import { readAllRows, readRelatedRows } from "@/lib/server/paginatedRead";
import { summarizePlayerHome, type HomeHistorySession, type HomeHistoryItem, type HomeHistoryEvent, type HomeHistoryAttendance } from "@/lib/playerHomeSummary";

type Session = HomeHistorySession & { location_text: string | null; coach_name: string | null; notes: string | null };
type Event = HomeHistoryEvent & { club_id: string; group_id: string | null; location_text: string | null };
type Round = { id: string; start_at: string };
type Item = HomeHistoryItem & { id: string };

export async function GET(req: NextRequest) {
  const timing = createRequestTiming();
  try {
    const url = new URL(req.url), view = url.searchParams.get("view") ?? "dashboard";
    if (!["dashboard", "rounds", "pending"].includes(view)) return NextResponse.json({ error: "Invalid view" }, { status: 400, headers: legalNoStore });
    const access = await timing.measure("access", () => resolveAuthenticatedPlayerAccess({ accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: url.searchParams.get("child_id"), requestedOrganizationId: requestedOrganizationId(req.url), mode: "view" }));
    const db = access.supabaseAdmin, playerId = access.subjectPlayerId, orgIds = access.organizationIds;
    const personal = (await timing.measure("personal_access", () => Promise.all(orgIds.map(id => canReadPlayerHistory(db, access.actorUserId, playerId, id))))).some(Boolean);
    const scope = (column: "club_id" | "organization_id") => personal ? personalOrOrganizationFilter(column, orgIds) : `${column}.in.(${orgIds.join(",")})`;
    const identity = { viewerUserId: access.actorUserId, effectiveUserId: playerId, role: access.viewerRole, organizationIds: orgIds };
    const readRounds = async () => {
      const rounds = await readAllRows<Round>((from, to) => db.from("golf_rounds")
        .select("id,start_at,round_type,competition_name,course_name,location,tee_name,slope_rating,course_rating,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus,score_entry_mode")
        .eq("user_id", playerId).or(scope("club_id")).order("start_at").order("id").range(from, to));
      const holes = await readRelatedRows(rounds.map(row => row.id), (ids, from, to) => db.from("golf_round_holes")
        .select("id,round_id,hole_no,par,score,putts,fairway_hit,stroke_index,note").in("round_id", ids).order("id").range(from, to));
      return { rounds, holes };
    };
    if (view === "rounds") {
      return NextResponse.json({ ...identity, ...await timing.measure("rounds", readRounds) }, { headers: { ...legalNoStore, ...timing.headers() } });
    }
    const readTraining = async () => {
      const [sessions, attendees, performance] = await Promise.all([
        readAllRows<Session>((from, to) => db.from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,location_text,coach_name,notes")
          .eq("user_id", playerId).or(scope("club_id")).order("id").range(from, to)),
        readAllRows<HomeHistoryAttendance>((from, to) => db.from("club_event_attendees").select("event_id,status")
          .eq("player_id", playerId).order("event_id").range(from, to)),
        db.from("club_members").select("id").eq("user_id", playerId).eq("role", "player")
          .eq("is_active", true).eq("is_performance", true).in("club_id", orgIds).limit(1),
      ]);
      if (performance.error) throw performance.error;
      const ids = [...new Set([...attendees.map(row => row.event_id), ...sessions.map(row => row.club_event_id)].filter((id): id is string => Boolean(id)))];
      const [items, rawEvents] = await Promise.all([
        readRelatedRows<Item>(sessions.map(row => row.id), (ids, from, to) => db.from("training_session_items")
          .select("id,session_id,category,minutes").in("session_id", ids).order("id").range(from, to)),
        readRelatedRows<Event>(ids, (ids, from, to) => db.from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,status,requires_evaluation,club_id,group_id,location_text")
          .in("id", ids).in("club_id", orgIds).order("id").range(from, to)),
      ]);
      // A cancelled/draft camp can still have scheduled day events.
      const campLinks = await readRelatedRows<{ event_id: string; camp_id: string }>(
        rawEvents.filter(event => event.event_type === "camp").map(event => event.id),
        (ids, from, to) => db.from("club_camp_days").select("event_id,camp_id").in("event_id", ids).order("id").range(from, to));
      const camps = await readRelatedRows<{ id: string; status: string }>(campLinks.map(row => row.camp_id),
        (ids, from, to) => db.from("club_camps").select("id,status").in("id", ids).in("club_id", orgIds).order("id").range(from, to));
      const visibleCamps = new Set(camps.filter(camp => camp.status === "scheduled").map(camp => camp.id));
      const hiddenCampEvents = new Set(campLinks.filter(link => !visibleCamps.has(link.camp_id)).map(link => link.event_id));
      const events = rawEvents.filter(event => !hiddenCampEvents.has(event.id));
      const eventIds = new Set(events.map(row => row.id));
      const visibleAttendance = attendees.filter(row => eventIds.has(row.event_id));
      const now = new Date(), month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const summary = summarizePlayerHome({ sessions, items, events, attendees: visibleAttendance, performanceEnabled: Boolean(performance.data?.length),
        now: now.toISOString(), monthStart: month.toISOString(), monthEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
        previousMonthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString() });
      return { sessions, items, events, pending: summary.pendingTrainings, performanceEnabled: Boolean(performance.data?.length),
        attendance: Object.fromEntries(visibleAttendance.map(row => [row.event_id, row.status])) };
    };
    if (view === "pending") {
      const data = await timing.measure("training", readTraining);
      const sessionsByEvent = new Map(data.sessions.filter(row => row.club_event_id).map(row => [row.club_event_id, row]));
      const eventsById = new Map(data.events.map(row => [row.id, row]));
      const sessionsById = new Map(data.sessions.map(row => [row.id, row]));
      const rows = data.pending.map(row => {
        const event = eventsById.get(row.id), session = event ? sessionsByEvent.get(event.id) : sessionsById.get(row.id);
        return session ? { kind: "session", id: session.id, starts_at: session.start_at, club_event_id: session.club_event_id, location_text: session.location_text, href: row.href }
          : { kind: "event", ...event!, href: row.href };
      });
      const relevant = data.events.filter(event => data.pending.some(row => row.id === event.id));
      const clubIds = [...new Set(relevant.map(row => row.club_id))], groupIds = [...new Set(relevant.map(row => row.group_id).filter((id): id is string => Boolean(id)))];
      const [clubs, groups] = await timing.measure("names", () => Promise.all([
        clubIds.length ? db.from("organizations").select("id,name").in("id", clubIds) : { data: [], error: null },
        groupIds.length ? db.from("coach_groups").select("id,name").in("id", groupIds).in("club_id", orgIds) : { data: [], error: null },
      ]));
      if (clubs.error) throw clubs.error;
      if (groups.error) throw groups.error;
      return NextResponse.json({ ...identity, rows, performanceEnabled: data.performanceEnabled,
        eventById: Object.fromEntries(relevant.map(row => [row.id, row])),
        clubNameById: Object.fromEntries((clubs.data ?? []).map(row => [row.id, row.name])),
        groupNameById: Object.fromEntries((groups.data ?? []).map(row => [row.id, row.name])) }, { headers: { ...legalNoStore, ...timing.headers() } });
    }
    const [training, roundData, profile, history, targets, settings, seasons] = await timing.measure("data", () => Promise.all([
      readTraining(), readRounds(),
      db.from("profiles").select("handicap").eq("id", playerId).maybeSingle(),
      personal ? readAllRows((from, to) => db.from("player_handicap_history").select("id,effective_date,value,note")
        .eq("user_id", playerId).order("effective_date", { ascending: false }).order("id").range(from, to)) : [],
      db.from("training_volume_targets").select("id,organization_id,ftem_code,level_label,handicap_label,handicap_min,handicap_max,motivation_text,minutes_offseason,minutes_inseason,sort_order")
        .in("organization_id", orgIds).order("sort_order").order("ftem_code"),
      db.from("training_volume_settings").select("organization_id,season_months,offseason_months").in("organization_id", orgIds),
      db.from("club_seasons").select("id,club_id,name,starts_on,ends_on,is_current").in("club_id", orgIds).order("starts_on", { ascending: false }),
    ]));
    for (const result of [profile, targets, settings, seasons]) if (result.error) throw result.error;
    return NextResponse.json({ ...identity, ...training, ...roundData, handicap: profile.data?.handicap ?? null, handicapHistory: history,
      volumeConfigs: orgIds.map(id => ({ rows: (targets.data ?? []).filter(row => row.organization_id === id),
        settings: (settings.data ?? []).find(row => row.organization_id === id) ?? null,
        seasons: (seasons.data ?? []).filter(row => row.club_id === id) })) }, { headers: { ...legalNoStore, ...timing.headers() } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load golf data" },
      { status: playerAccessErrorStatus(error), headers: { ...legalNoStore, ...timing.headers() } });
  }
}
