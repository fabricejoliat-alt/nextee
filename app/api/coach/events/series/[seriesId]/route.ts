import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isOrgStaffMember, requireCaller } from "@/app/api/messages/_lib";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const MISSING_TABLE = "42P01";

async function cleanupEventDependencies(supabaseAdmin: any, eventId: string) {
  const ignoreMissingTable = (err: any) => String(err?.code ?? "") === MISSING_TABLE;
  const deleteByEventId = async (table: string) => {
    const res = await supabaseAdmin.from(table).delete().eq("event_id", eventId);
    if (res.error && !ignoreMissingTable(res.error)) return res.error;
    return null;
  };

  for (const table of [
    "club_event_attendees",
    "club_event_coaches",
    "club_event_structure_items",
    "club_event_player_structure_items",
    "club_event_player_feedback",
    "club_event_coach_feedback",
  ]) {
    const err = await deleteByEventId(table);
    if (err) throw new Error(err.message);
  }

  const trainingSessionIdsRes = await supabaseAdmin
    .from("training_sessions")
    .select("id")
    .eq("club_event_id", eventId);
  if (trainingSessionIdsRes.error && !ignoreMissingTable(trainingSessionIdsRes.error)) {
    throw new Error(trainingSessionIdsRes.error.message);
  }

  const trainingSessionIds = (trainingSessionIdsRes.data ?? [])
    .map((r: any) => String(r.id ?? "").trim())
    .filter(Boolean);
  if (trainingSessionIds.length > 0) {
    const delSessionItemsRes = await supabaseAdmin
      .from("training_session_items")
      .delete()
      .in("session_id", trainingSessionIds);
    if (delSessionItemsRes.error && !ignoreMissingTable(delSessionItemsRes.error)) {
      throw new Error(delSessionItemsRes.error.message);
    }
  }

  const trainingSessionsRes = await supabaseAdmin.from("training_sessions").delete().eq("club_event_id", eventId);
  if (trainingSessionsRes.error && !ignoreMissingTable(trainingSessionsRes.error)) {
    throw new Error(trainingSessionsRes.error.message);
  }

  const deleteThreadsRes = await supabaseAdmin.from("message_threads").delete().eq("event_id", eventId);
  if (deleteThreadsRes.error && !ignoreMissingTable(deleteThreadsRes.error)) {
    throw new Error(deleteThreadsRes.error.message);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ seriesId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { seriesId: rawSeriesId } = await ctx.params;
    const seriesId = String(rawSeriesId ?? "").trim();
    if (!seriesId) return NextResponse.json({ error: "Missing seriesId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { callerId } = await requireCaller(accessToken);

    const seriesRes = await supabaseAdmin
      .from("club_event_series")
      .select("id,club_id")
      .eq("id", seriesId)
      .maybeSingle();
    if (seriesRes.error) return NextResponse.json({ error: seriesRes.error.message }, { status: 400 });
    if (!seriesRes.data?.id) return NextResponse.json({ error: "Series not found" }, { status: 404 });

    const clubId = String((seriesRes.data as { club_id?: string | null }).club_id ?? "").trim();
    if (!clubId) return NextResponse.json({ error: "Series club missing" }, { status: 400 });

    const staffAllowed = await isOrgStaffMember(supabaseAdmin, clubId, callerId);
    if (!staffAllowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const eventsRes = await supabaseAdmin.from("club_events").select("id").eq("series_id", seriesId);
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    const eventIds = ((eventsRes.data ?? []) as Array<{ id: string | null }>)
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean);

    for (const eventId of eventIds) {
      await cleanupEventDependencies(supabaseAdmin, eventId);
      const delRes = await supabaseAdmin.from("club_events").delete().eq("id", eventId);
      if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });
    }

    const delSeriesRes = await supabaseAdmin.from("club_event_series").delete().eq("id", seriesId);
    if (delSeriesRes.error) return NextResponse.json({ error: delSeriesRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, deleted_series_id: seriesId, deleted_events: eventIds.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
