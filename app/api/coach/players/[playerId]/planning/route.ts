import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

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
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    const sharedClubIds = access.sharedClubIds;
    if (sharedClubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const evRes = await supabaseAdmin
      .from("club_events")
      .select("id,starts_at,ends_at,event_type,title,group_id,location_text,club_id,status")
      .in("club_id", sharedClubIds)
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(300);
    if (evRes.error) return NextResponse.json({ error: evRes.error.message }, { status: 400 });

    const candidateEvents = evRes.data ?? [];
    const candidateEventIds = Array.from(
      new Set(candidateEvents.map((e: any) => String(e.id ?? "")).filter(Boolean))
    );
    if (candidateEventIds.length === 0) return NextResponse.json({ events: [] });

    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("event_id")
      .eq("player_id", playerId)
      .in("event_id", candidateEventIds)
      .limit(300);
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });

    const attendeeEventIds = new Set(
      ((attendeeRes.data ?? []) as Array<{ event_id: string | null }>)
        .map((row) => String(row.event_id ?? ""))
        .filter(Boolean)
    );
    const campEventIds = candidateEvents
      .filter((event: any) => String(event.event_type ?? "") === "camp")
      .map((event: any) => String(event.id ?? ""))
      .filter(Boolean);

    const registeredCampEventIds = new Set<string>();
    if (campEventIds.length > 0) {
      const campDaysRes = await supabaseAdmin
        .from("club_camp_days")
        .select("camp_id,event_id")
        .in("event_id", campEventIds)
        .limit(300);
      if (campDaysRes.error) return NextResponse.json({ error: campDaysRes.error.message }, { status: 400 });

      const campIdByEventId = new Map<string, string>();
      for (const row of (campDaysRes.data ?? []) as Array<{ camp_id: string | null; event_id: string | null }>) {
        const eventId = String(row.event_id ?? "").trim();
        const campId = String(row.camp_id ?? "").trim();
        if (!eventId || !campId) continue;
        campIdByEventId.set(eventId, campId);
      }

      const campIds = Array.from(new Set(Array.from(campIdByEventId.values())));
      if (campIds.length > 0) {
        const campPlayersRes = await supabaseAdmin
          .from("club_camp_players")
          .select("camp_id,registration_status")
          .eq("player_id", playerId)
          .in("camp_id", campIds)
          .limit(300);
        if (campPlayersRes.error) return NextResponse.json({ error: campPlayersRes.error.message }, { status: 400 });

        const registeredCampIds = new Set(
          ((campPlayersRes.data ?? []) as Array<{ camp_id: string | null; registration_status: string | null }>)
            .filter((row) => String(row.registration_status ?? "").trim() === "registered")
            .map((row) => String(row.camp_id ?? "").trim())
            .filter(Boolean)
        );

        for (const [eventId, campId] of campIdByEventId.entries()) {
          if (registeredCampIds.has(campId)) registeredCampEventIds.add(eventId);
        }
      }
    }

    const events = candidateEvents
      .filter((event: any) => {
        const eventId = String(event.id ?? "");
        const eventType = String(event.event_type ?? "");
        if (eventType === "camp") return registeredCampEventIds.has(eventId);
        return attendeeEventIds.has(eventId);
      })
      .slice(0, 100);
    if (events.length === 0) return NextResponse.json({ events: [] });
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
