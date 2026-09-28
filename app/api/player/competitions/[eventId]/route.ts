import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId: rawEventId } = await params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: childId,
      mode: "view",
    });
    const { supabaseAdmin } = access;

    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("status")
      .eq("event_id", eventId)
      .eq("player_id", access.subjectPlayerId)
      .maybeSingle();
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (!attendeeRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,status,competition_level,competition_category,external_registration_url,competition_note")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!["competition", "interclub"].includes(String(eventRes.data.event_type))) {
      return NextResponse.json({ error: "Competition only" }, { status: 400 });
    }

    const [clubRes, groupRes, reminderRes, membershipsRes] = await Promise.all([
      eventRes.data.club_id
        ? supabaseAdmin.from("clubs").select("name").eq("id", eventRes.data.club_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      eventRes.data.group_id
        ? supabaseAdmin.from("coach_groups").select("name").eq("id", eventRes.data.group_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabaseAdmin
        .from("club_event_reminders")
        .select("scheduled_for,channel,message_template,status,sent_at")
        .eq("event_id", eventId)
        .maybeSingle(),
      supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", access.subjectPlayerId)
        .eq("is_active", true),
    ]);
    if (clubRes.error) return NextResponse.json({ error: clubRes.error.message }, { status: 400 });
    if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 400 });
    if (reminderRes.error) return NextResponse.json({ error: reminderRes.error.message }, { status: 400 });
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const clubIds = new Set(
      (membershipsRes.data ?? []).map((row) => String(row.club_id ?? "").trim()).filter(Boolean),
    );

    return NextResponse.json({
      event: eventRes.data,
      attendanceStatus: attendeeRes.data.status ?? null,
      clubName: String(clubRes.data?.name ?? "").trim() || null,
      groupName: String(groupRes.data?.name ?? "").trim() || null,
      showClubName: clubIds.size > 1,
      reminder: reminderRes.data?.status === "cancelled" ? null : reminderRes.data ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error) },
    );
  }
}
