import { authorizedCoachPlayers } from "@/lib/coachAccess";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveCoachAssignments } from "@/lib/coachAccess";
import { coachEventEndMs, coachTrainingEvaluationComplete } from "@/lib/coachCalendar";
import { loadCoachEvaluationState } from "@/lib/server/coachEvaluation";
import { coachRows } from "@/lib/server/coachRows";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  title: string | null;
  camp_day_index?: number | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
  requires_evaluation: boolean;
};


function sortByStartsAtAsc<T extends { starts_at: string }>(items: T[]) {
  return [...items].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const coachId = callerData.user.id;

    const meRes = await supabaseAdmin
      .from("profiles")
      .select("first_name,last_name,avatar_url")
      .eq("id", coachId)
      .maybeSingle();
    const me = !meRes.error && meRes.data ? meRes.data : null;

    const scope = await resolveCoachAssignments(supabaseAdmin, coachId, requestedOrganizationId(req.url));
    const groupIds = scope.groups.map((group) => group.id);
    const eventIdsFromAssign = scope.eventIds;

    if (groupIds.length === 0 && eventIdsFromAssign.length === 0) {
      return NextResponse.json({
        me,
        groupNameById: {},
        clubNameByGroupId: {},
        organizationNames: [],
        upcomingEvents: [],
        pendingEvalEvents: [],
        groupCount: 0,
        playerCount: 0,
        pendingAttendanceCount: 0,
        pendingEvaluationCount: 0,
      });
    }

    const groupNameById: Record<string, string> = {};
    const groupClubIdById: Record<string, string> = {};
    const clubNameByGroupId: Record<string, string> = {};
    let organizationNames: string[] = [];
    const clubIds = new Set<string>();

    const nowIso = new Date().toISOString();
    const rowsById: Record<string, EventLite> = {};

    if (groupIds.length > 0) {
      const [groupUpcomingRes, groupPastRes, groupsRes] = await Promise.all([
        supabaseAdmin
          .from("club_events")
          .select("id,group_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,status,requires_evaluation")
          .in("group_id", groupIds)
          .in("club_id", scope.clubIds)
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(80),
        coachRows<EventLite>((from, to) => supabaseAdmin
          .from("club_events")
          .select("id,group_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,status,requires_evaluation")
          .in("group_id", groupIds)
          .in("club_id", scope.clubIds)
          .lt("starts_at", nowIso)
          .order("starts_at", { ascending: false })
          .order("id").range(from, to)).then((data) => ({ data, error: null })),
        supabaseAdmin.from("coach_groups").select("id,name,club_id").in("id", groupIds),
      ]);
      if (groupUpcomingRes.error) return NextResponse.json({ error: groupUpcomingRes.error.message }, { status: 400 });
      if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });

      (groupsRes.data ?? []).forEach((g: { id: string; name: string | null; club_id: string | null }) => {
        const name = String(g.name ?? "").trim();
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const isArchived = normalized.includes("archive") && normalized.includes("historique");
        if (!isArchived) {
          groupNameById[g.id] = g.name ?? "Groupe";
        }
        const cid = String(g.club_id ?? "").trim();
        if (cid) { clubIds.add(cid); groupClubIdById[g.id] = cid; }
      });

      [...((groupUpcomingRes.data ?? []) as EventLite[]), ...((groupPastRes.data ?? []) as EventLite[])].forEach((event) => {
        if (groupNameById[event.group_id]) rowsById[event.id] = event;
      });
    }

    if (eventIdsFromAssign.length > 0) {
      const assignedEvents = await coachRows<EventLite>((from, to) => supabaseAdmin
        .from("club_events")
        .select("id,group_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,status,requires_evaluation")
        .in("id", eventIdsFromAssign)
        .in("club_id", scope.clubIds)
        .order("starts_at", { ascending: false }).order("id").range(from, to));
      const missingGroupIds = Array.from(
        new Set(assignedEvents.map((e) => String(e.group_id ?? "").trim()).filter((id) => Boolean(id) && !groupNameById[id]))
      );
      if (missingGroupIds.length > 0) {
        const missingGroupsRes = await supabaseAdmin.from("coach_groups").select("id,name,club_id").in("id", missingGroupIds);
        if (missingGroupsRes.error) return NextResponse.json({ error: missingGroupsRes.error.message }, { status: 400 });
        (missingGroupsRes.data ?? []).forEach((g: { id: string; name: string | null; club_id: string | null }) => {
          const name = String(g.name ?? "").trim();
          const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const isArchived = normalized.includes("archive") && normalized.includes("historique");
          if (!isArchived) {
            groupNameById[g.id] = g.name ?? "Groupe";
          }
          const cid = String(g.club_id ?? "").trim();
          if (cid) { clubIds.add(cid); groupClubIdById[g.id] = cid; }
        });
      }

      assignedEvents.forEach((event) => {
        if (groupNameById[event.group_id]) rowsById[event.id] = event;
      });
    }

    if (clubIds.size > 0) {
      const clubsRes = await supabaseAdmin.from("organizations").select("id,name").in("id", Array.from(clubIds));
      if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
      organizationNames = Array.from(
        new Set((clubsRes.data ?? []).map((c: { name: string | null }) => String(c.name ?? "").trim()).filter(Boolean))
      );
      const clubNameById = new Map((clubsRes.data ?? []).map((club: { id: string; name: string | null }) => [club.id, String(club.name ?? "Club")]));
      Object.entries(groupClubIdById).forEach(([groupId, clubId]) => { clubNameByGroupId[groupId] = clubNameById.get(clubId) ?? "Club"; });
    }

    const allEvents = Object.values(rowsById);
    const campEventIds = allEvents
      .filter((event) => event.event_type === "camp")
      .map((event) => String(event.id ?? "").trim())
      .filter(Boolean);
    let campDayIndexByEventId: Record<string, number> = {};
    if (campEventIds.length > 0) {
      const campDaysRes = await supabaseAdmin
        .from("club_camp_days")
        .select("event_id,day_index")
        .in("event_id", campEventIds);
      if (campDaysRes.error) return NextResponse.json({ error: campDaysRes.error.message }, { status: 400 });
      campDayIndexByEventId = (campDaysRes.data ?? []).reduce<Record<string, number>>((acc, row: { event_id: string | null; day_index: number | null }) => {
        const eventId = String(row?.event_id ?? "").trim();
        if (!eventId) return acc;
        acc[eventId] = typeof row?.day_index === "number" ? row.day_index : 0;
        return acc;
      }, {});
    }

    const allEventsWithCampDay = allEvents.map((event) => ({
      ...event,
      camp_day_index:
        event.event_type === "camp" ? (campDayIndexByEventId[String(event.id ?? "").trim()] ?? null) : null,
    }));
    const upcomingEvents = sortByStartsAtAsc(allEventsWithCampDay.filter((e) => e.status === "scheduled" && new Date(e.starts_at).getTime() >= new Date(nowIso).getTime())).slice(0, 80);
    const pastEvents = allEventsWithCampDay
      .filter((e) => e.status === "scheduled" && coachEventEndMs(e) <= new Date(nowIso).getTime())
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
    const evaluationEvents = pastEvents.filter((event) => event.event_type === "training" && event.requires_evaluation !== false);

    const groupPlayersRes = groupIds.length > 0
      ? await supabaseAdmin.from("coach_group_players").select("player_user_id").in("group_id", groupIds)
      : { data: [], error: null };
    if (groupPlayersRes.error) return NextResponse.json({ error: groupPlayersRes.error.message }, { status: 400 });
    const candidatePlayers = new Set(
      (groupPlayersRes.data ?? []).map((row: { player_user_id: string | null }) => String(row.player_user_id ?? "")).filter(Boolean)
    );

    const allowedByOrg=await Promise.all(scope.clubIds.map(id=>authorizedCoachPlayers(supabaseAdmin,coachId,id,[...candidatePlayers])));
    const followedPlayerIds=new Set(allowedByOrg.flatMap(ids=>[...ids]));
    if (pastEvents.length === 0) {
      return NextResponse.json({
        me,
        groupNameById,
        clubNameByGroupId,
        organizationNames,
        upcomingEvents,
        pendingEvalEvents: [],
        groupCount: groupIds.length,
        playerCount: followedPlayerIds.size,
        pendingAttendanceCount: 0,
        pendingEvaluationCount: 0,
      });
    }

    const evaluationState = await loadCoachEvaluationState(supabaseAdmin, evaluationEvents.map((event) => event.id));
    const pendingEvalEvents = evaluationEvents.filter((event) =>
      evaluationState.attendees.some((attendee) => attendee.event_id === event.id)
      && !evaluationState.completeByEvent[event.id]);
    const pendingAttendanceCount = evaluationState.attendees.filter((row) => row.coach_recorded_status == null).length;
    const pendingEvaluationCount = evaluationState.attendees.filter((attendee) =>
      !coachTrainingEvaluationComplete([attendee], evaluationState.feedback.filter((row) => row.event_id === attendee.event_id),
        evaluationState.criteria, evaluationState.responses)).length;

    return NextResponse.json({
      me,
      groupNameById,
      clubNameByGroupId,
      organizationNames,
      upcomingEvents,
      pendingEvalEvents,
      groupCount: groupIds.length,
      playerCount: followedPlayerIds.size,
      pendingAttendanceCount,
      pendingEvaluationCount,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
