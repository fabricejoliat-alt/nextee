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

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;
    const url = new URL(req.url);
    const ids = uniq((url.searchParams.get("ids") ?? "").split(","));
    const childIdRaw = String(url.searchParams.get("child_id") ?? "").trim();

    if (ids.length === 0) return NextResponse.json({ groups: [] });

    const roleRes = await supabaseAdmin
      .from("club_members")
      .select("role")
      .eq("user_id", callerId)
      .eq("is_active", true);

    if (roleRes.error) return NextResponse.json({ error: roleRes.error.message }, { status: 400 });
    const roles = new Set(((roleRes.data ?? []) as Array<{ role: string | null }>).map((r) => String(r.role ?? "")));
    const isParent = roles.has("parent");

    let effectivePlayerId = callerId;
    if (isParent && childIdRaw) {
      const linkRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", callerId)
        .eq("player_id", childIdRaw)
        .eq("can_view", true)
        .maybeSingle();
      if (linkRes.error) return NextResponse.json({ error: linkRes.error.message }, { status: 400 });
      if (!linkRes.data?.player_id) return NextResponse.json({ groups: [] });
      effectivePlayerId = String(linkRes.data.player_id);
    }

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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

