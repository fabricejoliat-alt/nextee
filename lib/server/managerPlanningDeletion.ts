import { NextResponse } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { notifyPlanningDeletion } from "@/lib/server/coachPlanningNotifications";

type DeletedEvent = { id: string; event_type: string | null; starts_at: string; location_text: string | null };
/** Authenticate before the service-only transaction; no sequential destructive fallback. */
export async function deleteManagerPlanning(req: Request, target: { eventId: string } | { seriesId: string }) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = "eventId" in target ? target.eventId : target.seriesId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_delete_scope" }, { status: 400 });
  }
  let caller;
  try { caller = await requireCaller(token); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { supabaseAdmin, callerId } = caller;
  try {
    const { data, error } = await supabaseAdmin.rpc("delete_manager_planning_v1", {
      p_actor_id: callerId,
      p_event_id: "eventId" in target ? target.eventId : null,
      p_series_id: "seriesId" in target ? target.seriesId : null,
      p_occurrence_confirmed: new URL(req.url).searchParams.get("scope") === "occurrence",
    });
    if (error) {
      const code = String(error.message ?? "");
      const status = code === "forbidden" ? 403 : ["event_not_found", "series_not_found"].includes(code) ? 404
        : ["occurrence_confirmation_required", "invalid_delete_scope"].includes(code) ? 400 : 503;
      return NextResponse.json({ error: status === 503 ? "planning_delete_unavailable" : code }, { status });
    }
    if (data?.ok !== true) return NextResponse.json({ error: "planning_delete_unconfirmed" }, { status: 503 });
    let notificationWarning = false;
    const events = data.events as DeletedEvent[];
    try {
      if (events?.length && data.recipient_ids?.length) await notifyPlanningDeletion(supabaseAdmin, callerId, events[0],
        data.recipient_ids, "seriesId" in target ? data.deleted_events : undefined, "seriesId" in target ? target.seriesId : null);
    } catch { notificationWarning = true; }
    // Deletion stays confirmed even if delivery fails. Never expose recipient IDs.
    return NextResponse.json({ ok: true, deleted_event_id: data.deleted_event_id,
      deleted_series_id: data.deleted_series_id, deleted_events: data.deleted_events, notification_warning: notificationWarning });
  } catch {
    return NextResponse.json({ error: "planning_delete_unavailable" }, { status: 503 });
  }
}
