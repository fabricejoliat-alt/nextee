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

    const callerId = String(callerData.user.id ?? "").trim();
    const url = new URL(req.url);
    const eventId = String(url.searchParams.get("event_id") ?? "").trim();
    const childId = String(url.searchParams.get("child_id") ?? "").trim();
    if (!eventId) return NextResponse.json({ attendees: [] });

    let effectivePlayerId = callerId;
    if (childId && childId !== callerId) {
      const guardianRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", callerId)
        .eq("player_id", childId)
        .eq("can_view", true)
        .maybeSingle();
      if (guardianRes.error) return NextResponse.json({ error: guardianRes.error.message }, { status: 400 });
      if (!guardianRes.data?.player_id) return NextResponse.json({ attendees: [] });
      effectivePlayerId = String(guardianRes.data.player_id);
    }

    const accessCheck = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id")
      .eq("event_id", eventId)
      .eq("player_id", effectivePlayerId)
      .maybeSingle();
    if (accessCheck.error) return NextResponse.json({ error: accessCheck.error.message }, { status: 400 });
    if (!accessCheck.data?.player_id) return NextResponse.json({ attendees: [] });

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("group_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    const groupId = String((eventRes.data as { group_id?: string | null } | null)?.group_id ?? "").trim();
    if (!groupId) return NextResponse.json({ attendees: [] });

    const groupPlayersRes = await supabaseAdmin
      .from("coach_group_players")
      .select("player_user_id")
      .eq("group_id", groupId);
    if (groupPlayersRes.error) return NextResponse.json({ error: groupPlayersRes.error.message }, { status: 400 });

    const groupPlayerIds = Array.from(
      new Set(
        ((groupPlayersRes.data ?? []) as Array<{ player_user_id: string | null }>)
          .map((r) => String(r.player_user_id ?? "").trim())
          .filter(Boolean)
      )
    );
    if (groupPlayerIds.length === 0) return NextResponse.json({ attendees: [] });

    const attendeesRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id,status")
      .eq("event_id", eventId)
      .in("player_id", groupPlayerIds);
    if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });

    const attendanceRows = (attendeesRes.data ?? []) as Array<{
      player_id: string | null;
      status: "expected" | "present" | "absent" | "excused" | null;
    }>;
    const statusByPlayerId: Record<string, "expected" | "present" | "absent" | "excused"> = {};
    attendanceRows.forEach((r) => {
      const pid = String(r.player_id ?? "").trim();
      if (!pid) return;
      statusByPlayerId[pid] = (r.status ?? "expected") as "expected" | "present" | "absent" | "excused";
    });

    const namesById: Record<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }> = {};
    if (groupPlayerIds.length > 0) {
      const profilesRes = await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", groupPlayerIds);
      if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
      (profilesRes.data ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }) => {
        namesById[String(p.id)] = {
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          avatar_url: p.avatar_url ?? null,
        };
      });
    }

    const attendees = groupPlayerIds
      .map((pid) => ({
        player_id: pid,
        status: statusByPlayerId[pid] ?? "expected",
        first_name: namesById[pid]?.first_name ?? null,
        last_name: namesById[pid]?.last_name ?? null,
        avatar_url: namesById[pid]?.avatar_url ?? null,
      }))
      .sort((a, b) => `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""}`, "fr"));

    return NextResponse.json({ attendees });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
