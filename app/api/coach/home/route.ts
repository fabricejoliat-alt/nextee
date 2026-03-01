import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};

type EventAttendeeLite = {
  event_id: string;
  player_id: string;
  status: "expected" | "present" | "absent" | "excused" | null;
};

type EventFeedbackLite = {
  event_id: string;
  player_id: string;
};

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

    const [headGroupsRes, extraGroupsRes] = await Promise.all([
      supabaseAdmin.from("coach_groups").select("id").eq("head_coach_user_id", coachId),
      supabaseAdmin.from("coach_group_coaches").select("group_id").eq("coach_user_id", coachId),
    ]);

    if (headGroupsRes.error) return NextResponse.json({ error: headGroupsRes.error.message }, { status: 400 });
    if (extraGroupsRes.error) return NextResponse.json({ error: extraGroupsRes.error.message }, { status: 400 });

    const groupIds = Array.from(
      new Set([
        ...(headGroupsRes.data ?? []).map((r: { id: string | null }) => String(r?.id ?? "").trim()),
        ...(extraGroupsRes.data ?? []).map((r: { group_id: string | null }) => String(r?.group_id ?? "").trim()),
      ])
    ).filter(Boolean);

    if (groupIds.length === 0) {
      return NextResponse.json({
        me,
        groupNameById: {},
        organizationNames: [],
        upcomingEvents: [],
        pendingEvalEvents: [],
      });
    }

    const groupsRes = await supabaseAdmin.from("coach_groups").select("id,name,club_id").in("id", groupIds);
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });

    const groupNameById: Record<string, string> = {};
    const planningGroupIds: string[] = [];
    let organizationNames: string[] = [];
    const clubIds = new Set<string>();
    (groupsRes.data ?? []).forEach((g: { id: string; name: string | null; club_id: string | null }) => {
      const name = String(g.name ?? "").trim();
      const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isArchived = normalized.includes("archive") && normalized.includes("historique");
      if (!isArchived) {
        groupNameById[g.id] = g.name ?? "Groupe";
        planningGroupIds.push(g.id);
      }
      const cid = String(g.club_id ?? "").trim();
      if (cid) clubIds.add(cid);
    });

    if (planningGroupIds.length === 0) {
      return NextResponse.json({
        me,
        groupNameById: {},
        organizationNames,
        upcomingEvents: [],
        pendingEvalEvents: [],
      });
    }

    if (clubIds.size > 0) {
      const clubsRes = await supabaseAdmin.from("clubs").select("id,name").in("id", Array.from(clubIds));
      if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
      organizationNames = Array.from(
        new Set(
          (clubsRes.data ?? [])
            .map((c: { name: string | null }) => String(c.name ?? "").trim())
            .filter(Boolean)
        )
      );
    }

    const nowIso = new Date().toISOString();
    const [upcomingRes, pastRes] = await Promise.all([
      supabaseAdmin
        .from("club_events")
        .select("id,group_id,event_type,starts_at,ends_at,location_text,status")
        .in("group_id", planningGroupIds)
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(5),
      supabaseAdmin
        .from("club_events")
        .select("id,group_id,event_type,starts_at,ends_at,location_text,status")
        .in("group_id", planningGroupIds)
        .in("event_type", ["training", "interclub", "camp"])
        .lt("starts_at", nowIso)
        .order("starts_at", { ascending: false })
        .limit(120),
    ]);
    if (upcomingRes.error) return NextResponse.json({ error: upcomingRes.error.message }, { status: 400 });
    if (pastRes.error) return NextResponse.json({ error: pastRes.error.message }, { status: 400 });

    const upcomingEvents = (upcomingRes.data ?? []) as EventLite[];
    const pastEvents = (pastRes.data ?? []) as EventLite[];
    if (pastEvents.length === 0) {
      return NextResponse.json({
        me,
        groupNameById,
        organizationNames,
        upcomingEvents,
        pendingEvalEvents: [],
      });
    }

    const pastIds = pastEvents.map((e) => e.id);
    const [attendeesRes, feedbackRes] = await Promise.all([
      supabaseAdmin.from("club_event_attendees").select("event_id,player_id,status").in("event_id", pastIds),
      supabaseAdmin.from("club_event_coach_feedback").select("event_id,player_id").eq("coach_id", coachId).in("event_id", pastIds),
    ]);
    if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
    if (feedbackRes.error) return NextResponse.json({ error: feedbackRes.error.message }, { status: 400 });

    const presentByEvent: Record<string, Set<string>> = {};
    ((attendeesRes.data ?? []) as EventAttendeeLite[]).forEach((r) => {
      if (r.status !== "present") return;
      if (!presentByEvent[r.event_id]) presentByEvent[r.event_id] = new Set<string>();
      presentByEvent[r.event_id].add(r.player_id);
    });

    const evaluatedByEvent: Record<string, Set<string>> = {};
    ((feedbackRes.data ?? []) as EventFeedbackLite[]).forEach((r) => {
      if (!evaluatedByEvent[r.event_id]) evaluatedByEvent[r.event_id] = new Set<string>();
      evaluatedByEvent[r.event_id].add(r.player_id);
    });

    const pendingEvalEvents = pastEvents.filter((e) => {
      const present = presentByEvent[e.id] ?? new Set<string>();
      if (present.size === 0) return false;
      const evaluated = evaluatedByEvent[e.id] ?? new Set<string>();
      for (const pid of present) {
        if (!evaluated.has(pid)) return true;
      }
      return false;
    });

    return NextResponse.json({
      me,
      groupNameById,
      organizationNames,
      upcomingEvents,
      pendingEvalEvents,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
