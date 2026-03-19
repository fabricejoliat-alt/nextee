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
    const url = new URL(req.url);
    const eventId = String(url.searchParams.get("event_id") ?? "").trim();
    const childId = String(url.searchParams.get("child_id") ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing event_id" }, { status: 400 });

    let effectivePlayerId = viewerUserId;
    if (childId && childId !== viewerUserId) {
      const guardianRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", viewerUserId)
        .eq("player_id", childId)
        .or("can_view.is.null,can_view.eq.true")
        .maybeSingle();
      if (guardianRes.error) return NextResponse.json({ error: guardianRes.error.message }, { status: 400 });
      if (!guardianRes.data?.player_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      effectivePlayerId = String(guardianRes.data.player_id);
    }

    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id")
      .eq("event_id", eventId)
      .eq("player_id", effectivePlayerId)
      .maybeSingle();
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (!attendeeRes.data?.player_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("id,group_id,club_id,event_type,starts_at,duration_minutes,location_text,status")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const event = eventRes.data as {
      id: string;
      group_id: string | null;
      club_id: string | null;
      event_type: string | null;
      starts_at: string;
      duration_minutes: number | null;
      location_text: string | null;
      status: string | null;
    };

    const [groupRes, clubRes, feedbackRes, playerStructureRes] = await Promise.all([
      event.group_id
        ? supabaseAdmin.from("coach_groups").select("name").eq("id", event.group_id).maybeSingle()
        : ({ data: null, error: null } as const),
      event.club_id
        ? supabaseAdmin.from("clubs").select("name").eq("id", event.club_id).maybeSingle()
        : ({ data: null, error: null } as const),
      supabaseAdmin
        .from("club_event_coach_feedback")
        .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,player_note")
        .eq("event_id", eventId)
        .eq("player_id", effectivePlayerId)
        .eq("visible_to_player", true),
      supabaseAdmin
        .from("club_event_player_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .eq("player_id", effectivePlayerId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 400 });
    if (clubRes.error) return NextResponse.json({ error: clubRes.error.message }, { status: 400 });
    if (feedbackRes.error) return NextResponse.json({ error: feedbackRes.error.message }, { status: 400 });
    if (playerStructureRes.error) return NextResponse.json({ error: playerStructureRes.error.message }, { status: 400 });

    const coachIds = uniq(((feedbackRes.data ?? []) as Array<{ coach_id: string | null }>).map((row) => row.coach_id));
    const coachProfilesRes = coachIds.length
      ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", coachIds)
      : ({ data: [], error: null } as const);
    if (coachProfilesRes.error) return NextResponse.json({ error: coachProfilesRes.error.message }, { status: 400 });

    const commonStructureRes =
      (playerStructureRes.data ?? []).length > 0
        ? ({ data: [], error: null } as const)
        : await supabaseAdmin
            .from("club_event_structure_items")
            .select("category,minutes,note,position")
            .eq("event_id", eventId)
            .order("position", { ascending: true })
            .order("created_at", { ascending: true });
    if (commonStructureRes.error) return NextResponse.json({ error: commonStructureRes.error.message }, { status: 400 });

    return NextResponse.json({
      event,
      groupName: String((groupRes.data as { name?: string | null } | null)?.name ?? ""),
      clubName: String((clubRes.data as { name?: string | null } | null)?.name ?? ""),
      coachFeedback: feedbackRes.data ?? [],
      coachProfiles: coachProfilesRes.data ?? [],
      plannedStructureItems:
        (playerStructureRes.data ?? []).length > 0 ? playerStructureRes.data ?? [] : commonStructureRes.data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
