import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

export async function PUT(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const eventIds = uniq(Array.isArray(body?.event_ids) ? body.event_ids : []);
    const coachIds = uniq(Array.isArray(body?.coach_ids) ? body.coach_ids : []);
    if (eventIds.length === 0) return NextResponse.json({ error: "Missing event_ids" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const callerId = String(callerData.user.id ?? "").trim();

    const eventsRes = await supabaseAdmin.from("club_events").select("id,club_id").in("id", eventIds);
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    const events = (eventsRes.data ?? []) as Array<{ id: string | null; club_id: string | null }>;
    if (events.length !== eventIds.length) return NextResponse.json({ error: "One or more events not found" }, { status: 404 });

    const clubIds = uniq(events.map((row) => String(row.club_id ?? "")));
    if (clubIds.length !== 1) {
      return NextResponse.json({ error: "Events must belong to the same club" }, { status: 400 });
    }
    const clubId = clubIds[0];

    const managerRes = await supabaseAdmin
      .from("club_members")
      .select("id")
      .eq("club_id", clubId)
      .eq("user_id", callerId)
      .eq("role", "manager")
      .eq("is_active", true)
      .maybeSingle();
    if (managerRes.error) return NextResponse.json({ error: managerRes.error.message }, { status: 400 });
    if (!managerRes.data?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (coachIds.length > 0) {
      const validCoachesRes = await supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", clubId)
        .eq("role", "coach")
        .eq("is_active", true)
        .in("user_id", coachIds);
      if (validCoachesRes.error) return NextResponse.json({ error: validCoachesRes.error.message }, { status: 400 });
      const validCoachIds = uniq(((validCoachesRes.data ?? []) as Array<{ user_id: string | null }>).map((row) => String(row.user_id ?? "")));
      if (validCoachIds.length !== coachIds.length) {
        return NextResponse.json({ error: "One or more selected coaches are not active in this club" }, { status: 400 });
      }
    }

    const delRes = await supabaseAdmin.from("club_event_coaches").delete().in("event_id", eventIds);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    if (coachIds.length > 0) {
      const rows = eventIds.flatMap((eventId) => coachIds.map((coachId) => ({ event_id: eventId, coach_id: coachId })));
      const insRes = await supabaseAdmin.from("club_event_coaches").upsert(rows, {
        onConflict: "event_id,coach_id",
        ignoreDuplicates: true,
      });
      if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
