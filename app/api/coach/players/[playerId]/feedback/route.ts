import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

/** Private feedback is never fetched directly with the browser's database role. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    const { supabaseAdmin, callerId } = await requireCaller(token);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    if (!access.sensitiveClubIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Bound the history to this player before limiting events, not to the first
    // thousand sessions of the entire club. Do not load private fields yet.
    const references = await supabaseAdmin.from("club_event_coach_feedback").select("event_id")
      .eq("player_id", playerId).limit(1000);
    if (references.error) throw new Error(references.error.message);
    const referencedIds = [...new Set((references.data ?? []).map((row) => String(row.event_id)))];
    if (!referencedIds.length) return NextResponse.json({ feedback: [], events: [] });
    const events = await supabaseAdmin.from("club_events").select("id,starts_at,event_type,status,club_id,title")
      .in("id", referencedIds).in("club_id", access.sensitiveClubIds).eq("event_type", "training")
      .lt("starts_at", new Date().toISOString()).order("starts_at", { ascending: false }).limit(1000);
    if (events.error) throw new Error(events.error.message);
    const eventIds = (events.data ?? []).map((event) => String(event.id));
    if (!eventIds.length) return NextResponse.json({ feedback: [], events: [] });
    const feedback = await supabaseAdmin.from("club_event_coach_feedback")
      .select("event_id,coach_id,engagement,attitude,performance,private_note,player_note")
      .eq("player_id", playerId).in("event_id", eventIds).limit(1000);
    if (feedback.error) throw new Error(feedback.error.message);
    const feedbackEventIds = new Set((feedback.data ?? []).map((row) => String(row.event_id)));
    return NextResponse.json({
      feedback: feedback.data ?? [],
      events: (events.data ?? []).filter((event) => feedbackEventIds.has(String(event.id))),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: message === "Invalid token" ? 401 : 500 });
  }
}
