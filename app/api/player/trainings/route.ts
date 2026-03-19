import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const viewerUserId = callerData.user.id;
    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();

    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("role")
      .eq("user_id", viewerUserId)
      .eq("is_active", true);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const roles = new Set(((membershipsRes.data ?? []) as Array<{ role: string | null }>).map((r) => String(r.role ?? "")));
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
      if (linkRes.data?.player_id) {
        effectiveUserId = String(linkRes.data.player_id);
      }
    }
    if (isParent && effectiveUserId === viewerUserId) {
      const childrenRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id,is_primary")
        .eq("guardian_user_id", viewerUserId)
        .or("can_view.is.null,can_view.eq.true")
        .order("is_primary", { ascending: false })
        .limit(1);
      if (childrenRes.error) return NextResponse.json({ error: childrenRes.error.message }, { status: 400 });
      const fallbackChildId = String(childrenRes.data?.[0]?.player_id ?? "").trim();
      if (fallbackChildId) effectiveUserId = fallbackChildId;
    }

    const [perfRes, profileRes, sessionsRes, attendeeRes, competitionRes] = await Promise.all([
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
        .from("training_sessions")
        .select("id,start_at,location_text,session_type,club_id,total_minutes,motivation,difficulty,satisfaction,created_at,club_event_id")
        .eq("user_id", effectiveUserId)
        .order("start_at", { ascending: false }),
      supabaseAdmin
        .from("club_event_attendees")
        .select("event_id,status")
        .eq("player_id", effectiveUserId),
      supabaseAdmin
        .from("player_activity_events")
        .select("id,user_id,event_type,title,starts_at,ends_at,location_text,notes,status,created_at")
        .eq("user_id", effectiveUserId)
        .order("starts_at", { ascending: false }),
    ]);

    if (perfRes.error) return NextResponse.json({ error: perfRes.error.message }, { status: 400 });
    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });
    if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error.message }, { status: 400 });
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (competitionRes.error) return NextResponse.json({ error: competitionRes.error.message }, { status: 400 });

    const sessions = sessionsRes.data ?? [];
    const attendeeRows = attendeeRes.data ?? [];
    const eventIds = uniq(attendeeRows.map((r: any) => r.event_id));
    const attendeeStatusByEventId: Record<string, "expected" | "present" | "absent" | "excused" | null> = {};
    attendeeRows.forEach((r: any) => {
      attendeeStatusByEventId[String(r.event_id)] = (r.status ?? null) as any;
    });

    const eventsRes = eventIds.length
      ? await supabaseAdmin
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,series_id,status")
          .in("id", eventIds)
          .order("starts_at", { ascending: false })
      : ({ data: [], error: null } as any);
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    const attendeeEvents = eventsRes.data ?? [];

    const clubIds = uniq([
      ...sessions.map((s: any) => s.club_id),
      ...attendeeEvents.map((e: any) => e.club_id),
    ]);
    const groupIds = uniq(attendeeEvents.map((e: any) => e.group_id));

    const [clubsRes, groupsRes] = await Promise.all([
      clubIds.length
        ? supabaseAdmin.from("clubs").select("id,name").in("id", clubIds)
        : ({ data: [], error: null } as any),
      groupIds.length
        ? supabaseAdmin.from("coach_groups").select("id,name").in("id", groupIds)
        : ({ data: [], error: null } as any),
    ]);
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });

    const clubNameById: Record<string, string> = {};
    (clubsRes.data ?? []).forEach((c: any) => {
      clubNameById[String(c.id)] = String(c.name ?? "Club");
    });

    const groupNameById: Record<string, string> = {};
    (groupsRes.data ?? []).forEach((g: any) => {
      groupNameById[String(g.id)] = String(g.name ?? "Groupe");
    });

    const fullName = `${String(profileRes.data?.first_name ?? "").trim()} ${String(profileRes.data?.last_name ?? "").trim()}`.trim();

    return NextResponse.json({
      viewerUserId,
      effectiveUserId,
      effectivePlayerName: fullName || "Joueur",
      performanceEnabled: (perfRes.data ?? []).length > 0,
      sessions,
      attendeeEvents,
      attendeeStatusByEventId,
      competitionEvents: competitionRes.data ?? [],
      clubNameById,
      groupNameById,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
