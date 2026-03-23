import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const viewerUserId = String(callerData.user.id ?? "").trim();
    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();

    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("role")
      .eq("user_id", viewerUserId)
      .eq("is_active", true);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const roles = new Set(((membershipsRes.data ?? []) as Array<{ role: string | null }>).map((row) => String(row.role ?? "")));
    const isParent = roles.has("parent");

    let effectiveUserId = viewerUserId;
    if (isParent && childId) {
      const linkRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", viewerUserId)
        .eq("player_id", childId)
        .or("can_view.is.null,can_view.eq.true")
        .maybeSingle();
      if (linkRes.error) return NextResponse.json({ error: linkRes.error.message }, { status: 400 });
      if (!linkRes.data?.player_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      effectiveUserId = String(linkRes.data.player_id ?? "").trim();
    } else if (isParent) {
      const fallbackChildRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id,is_primary")
        .eq("guardian_user_id", viewerUserId)
        .or("can_view.is.null,can_view.eq.true")
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1);
      if (fallbackChildRes.error) return NextResponse.json({ error: fallbackChildRes.error.message }, { status: 400 });
      const fallbackChildId = String(fallbackChildRes.data?.[0]?.player_id ?? "").trim();
      if (fallbackChildId) effectiveUserId = fallbackChildId;
    }

    const nowIso = new Date().toISOString();

    const [futureSessionsRes, attendeeRes, plannedCompetitionsRes] = await Promise.all([
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
        .in("status", ["expected", "present", "excused"]),
      supabaseAdmin
        .from("player_activity_events")
        .select("id,event_type,title,starts_at,ends_at,location_text,status")
        .eq("user_id", effectiveUserId)
        .eq("status", "scheduled")
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(5),
    ]);

    if (futureSessionsRes.error) return NextResponse.json({ error: futureSessionsRes.error.message }, { status: 400 });
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (plannedCompetitionsRes.error) return NextResponse.json({ error: plannedCompetitionsRes.error.message }, { status: 400 });

    const futureSessions = futureSessionsRes.data ?? [];
    const attendeeRows = attendeeRes.data ?? [];
    const plannedCompetitions = plannedCompetitionsRes.data ?? [];

    const attendeeStatusByEventId: Record<string, "expected" | "present" | "absent" | "excused" | null> = {};
    const attendeeEventIds = uniq((attendeeRows as Array<{ event_id: string | null }>).map((row) => row.event_id));
    attendeeRows.forEach((row: any) => {
      const eventId = String(row.event_id ?? "").trim();
      if (!eventId) return;
      attendeeStatusByEventId[eventId] = (row.status ?? null) as "expected" | "present" | "absent" | "excused" | null;
    });

    const plannedRes = attendeeEventIds.length
      ? await supabaseAdmin
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,status")
          .in("id", attendeeEventIds)
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(10)
      : ({ data: [], error: null } as const);
    if (plannedRes.error) return NextResponse.json({ error: plannedRes.error.message }, { status: 400 });
    const plannedEvents = plannedRes.data ?? [];

    const plannedEventIdSet = new Set(plannedEvents.map((event: any) => String(event.id ?? "").trim()).filter(Boolean));
    const dedupedFutureSessions = futureSessions.filter((session: any) => {
      const linkedEventId = String(session.club_event_id ?? "").trim();
      return !linkedEventId || !plannedEventIdSet.has(linkedEventId);
    });

    const clubIds = uniq([
      ...plannedEvents.map((event: any) => event.club_id),
      ...dedupedFutureSessions.map((session: any) => session.club_id),
    ]);
    const groupIds = uniq(plannedEvents.map((event: any) => event.group_id));
    const structureEventIds = uniq([
      ...plannedEvents.map((event: any) => event.id),
      ...futureSessions.map((session: any) => session.club_event_id),
    ]);

    const [clubsRes, groupsRes, structureRes] = await Promise.all([
      clubIds.length ? supabaseAdmin.from("clubs").select("id,name").in("id", clubIds) : ({ data: [], error: null } as const),
      groupIds.length ? supabaseAdmin.from("coach_groups").select("id,name").in("id", groupIds) : ({ data: [], error: null } as const),
      structureEventIds.length
        ? supabaseAdmin.from("club_event_structure_items").select("event_id,category,minutes,note").in("event_id", structureEventIds)
        : ({ data: [], error: null } as const),
    ]);
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (structureRes.error) return NextResponse.json({ error: structureRes.error.message }, { status: 400 });

    const clubNameById: Record<string, string> = {};
    (clubsRes.data ?? []).forEach((club: any) => {
      const id = String(club.id ?? "").trim();
      if (!id) return;
      clubNameById[id] = String(club.name ?? "Club");
    });

    const groupNameById: Record<string, string> = {};
    (groupsRes.data ?? []).forEach((group: any) => {
      const id = String(group.id ?? "").trim();
      if (!id) return;
      groupNameById[id] = String(group.name ?? "Groupe");
    });

    const eventStructureByEventId: Record<string, Array<{ event_id: string; category: string; minutes: number; note: string | null }>> = {};
    (structureRes.data ?? []).forEach((item: any) => {
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

    const upcomingActivities = [
      ...plannedEvents.map((event: any) => ({ kind: "event", key: `event-${event.id}`, dateIso: event.starts_at, event })),
      ...dedupedFutureSessions.map((session: any) => ({
        kind: "session",
        key: `session-${session.id}`,
        dateIso: session.start_at,
        session,
      })),
      ...plannedCompetitions.map((competition: any) => ({
        kind: "competition",
        key: `competition-${competition.id}`,
        dateIso: competition.starts_at,
        competition,
      })),
    ]
      .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime())
      .slice(0, 5);

    return NextResponse.json({
      viewerUserId,
      effectiveUserId,
      attendeeStatusByEventId,
      clubNameById,
      groupNameById,
      eventStructureByEventId,
      upcomingActivities,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
