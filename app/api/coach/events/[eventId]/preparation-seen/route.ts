import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import { isFutureTraining, normalizeCoachPreparationPoints } from "@/lib/coachPreparationInsights";
import { isCoachTrainingAssistanceEnabled } from "@/lib/server/coachTrainingAssistance";
import { loadCoachPreparationSources } from "@/lib/server/coachPreparationSources";
import { isMissingPreparationReads } from "@/lib/server/coachPreparationReads";
import { CoachAiAuthorizationError, coachAiSourceFingerprint, requireCoachAiGrant } from "@/lib/server/coachAiAuthorization";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { eventId } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body.player_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.player_id)
      || typeof body.source_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(body.source_fingerprint)) {
      return NextResponse.json({ error: "Invalid acknowledgement" }, { status: 400 });
    }
    const { supabaseAdmin: db, callerId } = await requireCaller(token);
    const event = await requireCoachEventAccess(db, callerId, eventId);
    if (event.status === "cancelled" || !isFutureTraining(event)
      || !(await isCoachTrainingAssistanceEnabled(db, event.club_id, callerId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const attendee = await db.from("club_event_attendees").select("player_id")
      .eq("event_id", eventId).eq("player_id", body.player_id).maybeSingle();
    if (attendee.error) throw new Error(attendee.error.message);
    if (!attendee.data) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const grant = await requireCoachAiGrant(db, callerId, event, body.player_id);
    const [{ sourceByPlayerId }, cache] = await Promise.all([
      loadCoachPreparationSources(db, event, [body.player_id]),
      db.from("coach_training_preparation_insights").select("source_fingerprint,attention_points")
        .eq("target_event_id", eventId).eq("player_id", body.player_id).maybeSingle(),
    ]);
    if (cache.error) throw new Error(cache.error.message);
    const sourceHash = sourceByPlayerId.get(body.player_id)?.sourceHash;
    if (!sourceHash || coachAiSourceFingerprint(sourceHash, grant) !== body.source_fingerprint
      || cache.data?.source_fingerprint !== body.source_fingerprint
      || !normalizeCoachPreparationPoints(cache.data?.attention_points).length) {
      return NextResponse.json({ error: "preparation_changed" }, { status: 409 });
    }
    const seenAt = new Date().toISOString();
    await requireCoachAiGrant(db, callerId, event, body.player_id, grant);
    const saved = await db.from("coach_training_preparation_reads").upsert({
      target_event_id: eventId, player_id: body.player_id, coach_id: callerId,
      source_fingerprint: body.source_fingerprint, seen_at: seenAt,
    }, { onConflict: "target_event_id,player_id,coach_id" }).select("seen_at").single();
    if (isMissingPreparationReads(saved.error)) return NextResponse.json({ error: "read_tracking_unavailable" }, { status: 503 });
    if (saved.error) throw new Error(saved.error.message);
    return NextResponse.json({ ok: true, seen_at: saved.data.seen_at });
  } catch (error) {
    if (error instanceof CoachAiAuthorizationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Server error";
    const status = message === "Invalid token" ? 401 : message === "forbidden" ? 403 : message === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: status === 500 ? "Server error" : message }, { status });
  }
}
