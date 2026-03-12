import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = String(callerData.user.id ?? "").trim();
    const eventRes = await supabaseAdmin.from("club_events").select("id,club_id,series_id").eq("id", eventId).maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data?.id) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const clubId = String((eventRes.data as { club_id?: string | null }).club_id ?? "").trim();
    const seriesId = String((eventRes.data as { series_id?: string | null }).series_id ?? "").trim();
    if (!clubId) return NextResponse.json({ error: "Event club missing" }, { status: 400 });
    if (seriesId) {
      return NextResponse.json({ error: "Recurring event: delete from recurrence editor only." }, { status: 400 });
    }

    const managerRes = await supabaseAdmin
      .from("club_members")
      .select("id")
      .eq("club_id", clubId)
      .eq("user_id", callerId)
      .eq("role", "manager")
      .eq("is_active", true)
      .maybeSingle();
    if (managerRes.error) return NextResponse.json({ error: managerRes.error.message }, { status: 400 });
    if (!managerRes.data?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const ignoreMissingTable = (err: any) => String(err?.code ?? "") === "42P01";
    const deleteByEventId = async (table: string) => {
      const res = await supabaseAdmin.from(table).delete().eq("event_id", eventId);
      if (res.error && !ignoreMissingTable(res.error)) return res.error;
      return null;
    };

    // Remove known dependent rows first to avoid FK blocks on club_events delete.
    for (const table of [
      "club_event_attendees",
      "club_event_coaches",
      "club_event_structure_items",
      "club_event_player_structure_items",
      "club_event_player_feedback",
      "club_event_coach_feedback",
    ]) {
      const err = await deleteByEventId(table);
      if (err) return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const trainingSessionIdsRes = await supabaseAdmin
      .from("training_sessions")
      .select("id")
      .eq("club_event_id", eventId);
    if (trainingSessionIdsRes.error && !ignoreMissingTable(trainingSessionIdsRes.error)) {
      return NextResponse.json({ error: trainingSessionIdsRes.error.message }, { status: 400 });
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
        return NextResponse.json({ error: delSessionItemsRes.error.message }, { status: 400 });
      }
    }

    const trainingSessionsRes = await supabaseAdmin.from("training_sessions").delete().eq("club_event_id", eventId);
    if (trainingSessionsRes.error && !ignoreMissingTable(trainingSessionsRes.error)) {
      return NextResponse.json({ error: trainingSessionsRes.error.message }, { status: 400 });
    }

    const deleteThreadsRes = await supabaseAdmin.from("message_threads").delete().eq("event_id", eventId);
    if (deleteThreadsRes.error && !ignoreMissingTable(deleteThreadsRes.error)) {
      return NextResponse.json({ error: deleteThreadsRes.error.message }, { status: 400 });
    }

    const delRes = await supabaseAdmin.from("club_events").delete().eq("id", eventId);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, deleted_event_id: eventId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
