import { deleteManagerPlanning } from "@/lib/server/managerPlanningDeletion";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { managerActivityClient, managerActivityError } from "@/lib/server/managerActivityWrites";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function managerEventContext(req: NextRequest, eventId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const eventRes = await supabaseAdmin
    .from("club_events")
    .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status,competition_level,competition_category,external_registration_url,competition_note")
    .eq("id", eventId)
    .maybeSingle();
  if (eventRes.error) return { ok: false as const, status: 400, error: eventRes.error.message };
  if (!eventRes.data?.id) return { ok: false as const, status: 404, error: "Event not found" };

  const callerId = String(callerData.user.id ?? "").trim();
  const clubId = String(eventRes.data.club_id ?? "").trim();
  const managerRes = await supabaseAdmin
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();
  if (managerRes.error) return { ok: false as const, status: 400, error: managerRes.error.message };
  if (!managerRes.data?.id) return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, supabaseAdmin, callerId, clubId, event: eventRes.data };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const context = await managerEventContext(req, eventId);
    if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
    if (String(context.event.event_type ?? "") !== "competition") {
      return NextResponse.json({ error: "This editor is only available for competitions" }, { status: 400 });
    }

    const { data, error } = await managerActivityClient(req).rpc("get_manager_competition_snapshot_v1", { p_event_id: eventId });
    if (error) {
      const { status, ...body } = managerActivityError(error);
      return NextResponse.json(body, { status });
    }
    if (!data?.event || !Array.isArray(data.attendees) || !Array.isArray(data.coaches)) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    return NextResponse.json({ event: data.event, snapshot: data,
      player_ids: data.attendees.map((row: { player_id: string }) => row.player_id),
      coach_ids: data.coaches.map((row: { coach_id: string }) => row.coach_id), reminder: data.reminder });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await ctx.params;
    const context = await managerEventContext(req, eventId);
    if (!context.ok) return NextResponse.json({ error: context.status === 401 ? "session" : "forbidden", outcome: "rejected" }, { status: context.status });
    const body = await req.json().catch(() => null);
    if (!body?.snapshot || body.eventType !== "competition") return NextResponse.json({ error: "invalid_request", outcome: "rejected" }, { status: 400 });
    const { snapshot, ...payload } = body;
    const { data, error } = await managerActivityClient(req).rpc("save_manager_competition_v1", { p_event_id: eventId, p_expected: snapshot, p_payload: payload });
    if (error) {
      const { status, ...body } = managerActivityError(error);
      return NextResponse.json(body, { status });
    }
    if (data?.ok !== true || data.firstEventId !== eventId) return NextResponse.json({ error: "unconfirmed", outcome: "unknown" }, { status: 503 });
    return NextResponse.json({ ok: true, firstEventId: eventId });
  } catch {
    return NextResponse.json({ error: "unconfirmed", outcome: "unknown" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  return deleteManagerPlanning(req, { eventId: (await ctx.params).eventId });
}
