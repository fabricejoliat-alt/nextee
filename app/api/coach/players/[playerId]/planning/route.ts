import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ playerId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const [meRes, playerRes] = await Promise.all([
      supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", callerId)
        .eq("is_active", true)
        .in("role", ["coach", "manager"]),
      supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", playerId)
        .eq("is_active", true),
    ]);
    if (meRes.error) return NextResponse.json({ error: meRes.error.message }, { status: 400 });
    if (playerRes.error) return NextResponse.json({ error: playerRes.error.message }, { status: 400 });

    const myClubIds = new Set((meRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
    const playerClubIds = Array.from(
      new Set((playerRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean))
    );
    const sharedClubIds = playerClubIds.filter((id) => myClubIds.has(id));
    if (sharedClubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("event_id")
      .eq("player_id", playerId)
      .limit(2000);
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });

    const eventIds = Array.from(
      new Set((attendeeRes.data ?? []).map((r: any) => String(r.event_id ?? "")).filter(Boolean))
    );
    if (eventIds.length === 0) return NextResponse.json({ events: [] });

    const evRes = await supabaseAdmin
      .from("club_events")
      .select("id,starts_at,ends_at,event_type,title,group_id,location_text,club_id,status")
      .in("id", eventIds)
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(100);
    if (evRes.error) return NextResponse.json({ error: evRes.error.message }, { status: 400 });

    const events = evRes.data ?? [];
    const groupIds = Array.from(new Set(events.map((e: any) => String(e.group_id ?? "")).filter(Boolean)));
    const clubIds = Array.from(new Set(events.map((e: any) => String(e.club_id ?? "")).filter(Boolean)));

    const [groupsRes, clubsRes] = await Promise.all([
      groupIds.length > 0
        ? supabaseAdmin.from("coach_groups").select("id,name").in("id", groupIds)
        : Promise.resolve({ data: [], error: null } as any),
      clubIds.length > 0
        ? supabaseAdmin.from("clubs").select("id,name").in("id", clubIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });

    const groupNameById: Record<string, string> = {};
    for (const g of groupsRes.data ?? []) groupNameById[String((g as any).id)] = String((g as any).name ?? "");

    const clubNameById: Record<string, string> = {};
    for (const c of clubsRes.data ?? []) clubNameById[String((c as any).id)] = String((c as any).name ?? "");

    return NextResponse.json({
      events: events.map((e: any) => ({
        ...e,
        group_name: e.group_id ? groupNameById[String(e.group_id)] ?? "" : "",
        organization_name: e.club_id ? clubNameById[String(e.club_id)] ?? "" : "",
        can_open_detail: Boolean(e.group_id && e.club_id && sharedClubIds.includes(String(e.club_id))),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
