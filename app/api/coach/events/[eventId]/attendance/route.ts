import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCaller } from "@/app/api/messages/_lib";
import { canCoachAccessEvent, requireCoachEventPlayer } from "@/lib/coachAccess";
import { playerEvaluationLockedIds } from "@/lib/server/playerEvaluationPresence";
import { evaluatedAttendanceStatus } from "@/lib/playerEvaluationPresence";

async function context(req: NextRequest, eventId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { callerId } = await requireCaller(token);
  const { data: event, error } = await db.from("club_events").select("id,group_id,club_id,event_type,status").eq("id", eventId).maybeSingle();
  if (error || !event || !(await canCoachAccessEvent(db, callerId, eventId, event.group_id, event.club_id))) return null;
  return { db, event, callerId };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await ctx.params;
    const scope = await context(req, eventId);
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ lockedPlayerIds: Array.from(await playerEvaluationLockedIds(scope.db, eventId)) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Attendance unavailable" }, { status: 503 }); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await ctx.params;
    const scope = await context(req, eventId);
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    if (scope.event.event_type !== "training" || scope.event.status === "cancelled"
      || typeof body.playerId !== "string" || !["present", "absent"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid attendance" }, { status: 400 });
    }
    const attendee = await scope.db.from("club_event_attendees").select("player_id,status,coach_recorded_status").eq("event_id", eventId).eq("player_id", body.playerId).maybeSingle();
    if (attendee.error || !attendee.data) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    await requireCoachEventPlayer(scope.db, eventId, body.playerId, scope.callerId, scope.event.club_id);
    if ((await playerEvaluationLockedIds(scope.db, eventId)).has(body.playerId)
      && body.status !== evaluatedAttendanceStatus(attendee.data.status, attendee.data.coach_recorded_status)) {
      return NextResponse.json({ error: "L’autoévaluation du joueur est enregistrée : la présence est verrouillée.", code: "attendance_locked_by_player_evaluation" }, { status: 409 });
    }
    const updated = await scope.db.from("club_event_attendees").update({ status: body.status, coach_recorded_status: body.status })
      .eq("event_id", eventId).eq("player_id", body.playerId).select("player_id").single();
    if (updated.error?.message === "attendance_locked_by_player_evaluation") {
      return NextResponse.json({ error: "L’autoévaluation du joueur est enregistrée : la présence est verrouillée.", code: updated.error.message }, { status: 409 });
    }
    if (updated.error) throw updated.error;
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Attendance update failed" }, { status: 503 }); }
}
