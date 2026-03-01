import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  location_text: string | null;
  coach_note: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const coachId = callerData.user.id;
    const [headRes, asstRes, eventCoachRes] = await Promise.all([
      supabaseAdmin.from("coach_groups").select("id").eq("head_coach_user_id", coachId),
      supabaseAdmin.from("coach_group_coaches").select("group_id").eq("coach_user_id", coachId),
      supabaseAdmin.from("club_event_coaches").select("event_id").eq("coach_id", coachId),
    ]);
    if (headRes.error) return NextResponse.json({ error: headRes.error.message }, { status: 400 });
    if (asstRes.error) return NextResponse.json({ error: asstRes.error.message }, { status: 400 });
    if (eventCoachRes.error) return NextResponse.json({ error: eventCoachRes.error.message }, { status: 400 });

    const groupIds = Array.from(
      new Set([
        ...(headRes.data ?? []).map((r: { id: string | null }) => String(r?.id ?? "").trim()),
        ...(asstRes.data ?? []).map((r: { group_id: string | null }) => String(r?.group_id ?? "").trim()),
      ])
    ).filter(Boolean);
    const eventIdsFromAssign = Array.from(
      new Set((eventCoachRes.data ?? []).map((r: { event_id: string | null }) => String(r?.event_id ?? "").trim()))
    ).filter(Boolean);

    const rowsById: Record<string, EventRow> = {};

    if (groupIds.length > 0) {
      const r = await supabaseAdmin
        .from("club_events")
        .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status")
        .in("group_id", groupIds)
        .order("starts_at", { ascending: true });
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 400 });
      (r.data ?? []).forEach((e: EventRow) => {
        rowsById[e.id] = e;
      });
    }

    if (eventIdsFromAssign.length > 0) {
      const r = await supabaseAdmin
        .from("club_events")
        .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status")
        .in("id", eventIdsFromAssign)
        .order("starts_at", { ascending: true });
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 400 });
      (r.data ?? []).forEach((e: EventRow) => {
        rowsById[e.id] = e;
      });
    }

    const events = Object.values(rowsById).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    if (events.length === 0) {
      return NextResponse.json({ events: [], groupNameById: {}, clubNameById: {} });
    }

    const gIds = Array.from(new Set(events.map((e) => String(e.group_id ?? "").trim()).filter(Boolean)));
    const cIds = Array.from(new Set(events.map((e) => String(e.club_id ?? "").trim()).filter(Boolean)));

    const [groupsRes, clubsRes] = await Promise.all([
      gIds.length > 0
        ? supabaseAdmin.from("coach_groups").select("id,name").in("id", gIds)
        : Promise.resolve({ data: [], error: null } as const),
      cIds.length > 0
        ? supabaseAdmin.from("clubs").select("id,name").in("id", cIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });

    const groupNameById: Record<string, string> = {};
    (groupsRes.data ?? []).forEach((g: { id: string; name: string | null }) => {
      groupNameById[g.id] = g.name ?? "Groupe";
    });

    const clubNameById: Record<string, string> = {};
    (clubsRes.data ?? []).forEach((c: { id: string; name: string | null }) => {
      clubNameById[c.id] = c.name ?? "Club";
    });

    return NextResponse.json({
      events,
      groupNameById,
      clubNameById,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

