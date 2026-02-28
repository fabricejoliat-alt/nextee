import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;
    const { data: memberships, error: membershipsError } = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("role", "manager")
      .eq("is_active", true);
    if (membershipsError) return NextResponse.json({ error: membershipsError.message }, { status: 400 });

    const clubIds = Array.from(new Set((memberships ?? []).map((m: any) => String(m?.club_id ?? "")).filter(Boolean)));
    if (clubIds.length === 0) {
      return NextResponse.json({ events: [], groups: [], clubs: [], attendees: [] });
    }

    const eventsRes = await supabaseAdmin
      .from("club_events")
      .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status")
      .in("club_id", clubIds)
      .order("starts_at", { ascending: true });
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    const events = eventsRes.data ?? [];

    const groupIds = Array.from(new Set(events.map((e: any) => String(e?.group_id ?? "")).filter(Boolean)));
    const eventIds = Array.from(new Set(events.map((e: any) => String(e?.id ?? "")).filter(Boolean)));

    const [groupsRes, clubsRes, attendeesRes] = await Promise.all([
      groupIds.length > 0
        ? supabaseAdmin.from("coach_groups").select("id,name,is_active,head_coach_user_id").in("id", groupIds)
        : Promise.resolve({ data: [], error: null } as any),
      supabaseAdmin.from("clubs").select("id,name").in("id", clubIds),
      eventIds.length > 0
        ? supabaseAdmin.from("club_event_attendees").select("event_id,player_id").in("event_id", eventIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });

    const groupsRaw = (groupsRes.data ?? []) as Array<{
      id: string;
      name: string | null;
      is_active: boolean | null;
      head_coach_user_id: string | null;
    }>;
    const headCoachIds = Array.from(
      new Set(groupsRaw.map((g) => String(g.head_coach_user_id ?? "").trim()).filter(Boolean))
    );
    const headCoachNameById = new Map<string, string>();
    if (headCoachIds.length > 0) {
      const profilesRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name")
        .in("id", headCoachIds);
      if (!profilesRes.error) {
        (profilesRes.data ?? []).forEach((p: any) => {
          const id = String(p?.id ?? "").trim();
          if (!id) return;
          const first = String(p?.first_name ?? "").trim();
          const last = String(p?.last_name ?? "").trim();
          const full = `${first} ${last}`.trim();
          headCoachNameById.set(id, full || id);
        });
      }
    }

    const groups = groupsRaw.map((g) => {
      const name = String(g.name ?? "").trim();
      const headId = String(g.head_coach_user_id ?? "").trim();
      return {
        id: g.id,
        name: g.name,
        is_active: g.is_active,
        is_archived: name === "__ARCHIVE_HISTORIQUE__",
        head_coach_user_id: g.head_coach_user_id,
        head_coach_name: headId ? headCoachNameById.get(headId) ?? null : null,
      };
    });

    return NextResponse.json({
      events,
      groups,
      clubs: clubsRes.data ?? [],
      attendees: attendeesRes.data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
