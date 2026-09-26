import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ids = uniq((url.searchParams.get("ids") ?? "").split(","));
    const childIdRaw = String(url.searchParams.get("child_id") ?? "").trim();

    if (ids.length === 0) return NextResponse.json({ groups: [] });
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: childIdRaw,
      mode: "view",
    });
    const { supabaseAdmin } = access;
    const effectivePlayerId = access.subjectPlayerId;

    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("event_id")
      .eq("player_id", effectivePlayerId);
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });

    const eventIds = uniq(((attendeeRes.data ?? []) as Array<{ event_id: string | null }>).map((r) => String(r.event_id ?? "")));
    if (eventIds.length === 0) return NextResponse.json({ groups: [] });

    const eventsRes = await supabaseAdmin
      .from("club_events")
      .select("group_id")
      .in("id", eventIds)
      .in("group_id", ids);
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });

    const allowedGroupIds = uniq(
      ((eventsRes.data ?? []) as Array<{ group_id: string | null }>).map((r) => String(r.group_id ?? ""))
    );
    if (allowedGroupIds.length === 0) return NextResponse.json({ groups: [] });

    const groupsRes = await supabaseAdmin
      .from("coach_groups")
      .select("id,name")
      .in("id", allowedGroupIds);
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });

    return NextResponse.json({ groups: groupsRes.data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error) }
    );
  }
}
