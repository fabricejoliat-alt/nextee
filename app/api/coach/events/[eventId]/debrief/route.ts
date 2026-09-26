import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import { CoachDebriefValidationError, normalizeDebriefSaveInput } from "@/lib/coachDebrief";
import { assertCoachTrainingReportAllowed } from "@/lib/coachTrainingAssistance";
import { isCoachTrainingAssistanceEnabled } from "@/lib/server/coachTrainingAssistance";

function httpError(message: string) {
  if (message === "event_not_found") return { status: 404, message: "Training not found." };
  if (message === "forbidden") return { status: 403, message: "Forbidden" };
  return { status: 400, message };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const event = await requireCoachEventAccess(supabaseAdmin, callerId, eventId);
    if (event.event_type !== "training") {
      return NextResponse.json({ error: "Only training sessions can be debriefed." }, { status: 400 });
    }

    const assistanceEnabled = await isCoachTrainingAssistanceEnabled(supabaseAdmin, event.club_id);
    const [attendeesRes, feedbackRes, debriefRes, groupRes] = await Promise.all([
      supabaseAdmin
        .from("club_event_attendees")
        .select("player_id,coach_recorded_status,coach_recorded_by,coach_recorded_at")
        .eq("event_id", eventId),
      supabaseAdmin
        .from("club_event_coach_feedback")
        .select("player_id,engagement,attitude,performance")
        .eq("event_id", eventId),
      supabaseAdmin
        .from("coach_training_debriefs")
        .select("id,report_text,report_scope,report_version,author_coach_id,updated_at")
        .eq("event_id", eventId)
        .maybeSingle(),
      supabaseAdmin.from("coach_groups").select("id,name").eq("id", event.group_id).maybeSingle(),
    ]);
    if (attendeesRes.error) throw new Error(attendeesRes.error.message);
    if (feedbackRes.error) throw new Error(feedbackRes.error.message);
    if (debriefRes.error) throw new Error(debriefRes.error.message);
    if (groupRes.error) throw new Error(groupRes.error.message);

    const attendeeRows = (attendeesRes.data ?? []) as Array<{
      player_id: string;
      coach_recorded_status: "present" | "absent" | null;
      coach_recorded_by: string | null;
      coach_recorded_at: string | null;
    }>;
    const playerIds = attendeeRows.map((row) => row.player_id);
    const profilesRes = playerIds.length
      ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", playerIds)
      : { data: [], error: null };
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const feedbackByPlayer = new Map(
      ((feedbackRes.data ?? []) as Array<{
        player_id: string;
        engagement: number | null;
        attitude: number | null;
        performance: number | null;
      }>).map((row) => [row.player_id, row])
    );
    const profileByPlayer = new Map(
      ((profilesRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>).map(
        (row) => [row.id, row]
      )
    );

    const attendees = attendeeRows
      .map((row) => ({
        ...row,
        profile: profileByPlayer.get(row.player_id) ?? null,
        feedback: feedbackByPlayer.get(row.player_id) ?? null,
      }))
      .sort((left, right) => {
        const leftName = `${left.profile?.last_name ?? ""} ${left.profile?.first_name ?? ""}`.trim();
        const rightName = `${right.profile?.last_name ?? ""} ${right.profile?.first_name ?? ""}`.trim();
        return leftName.localeCompare(rightName, "fr-CH");
      });

    return NextResponse.json({
      event,
      groupName: String(groupRes.data?.name ?? ""),
      attendees,
      debrief: assistanceEnabled ? debriefRes.data ?? null : null,
      coachTrainingAssistanceEnabled: assistanceEnabled,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const mapped = httpError(message);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const event = await requireCoachEventAccess(supabaseAdmin, callerId, eventId);
    if (event.event_type !== "training") {
      return NextResponse.json({ error: "Only training sessions can be debriefed." }, { status: 400 });
    }

    const attendeeRes = await supabaseAdmin.from("club_event_attendees").select("player_id").eq("event_id", eventId);
    if (attendeeRes.error) throw new Error(attendeeRes.error.message);
    const allowedIds = (attendeeRes.data ?? []).map((row: { player_id: string }) => row.player_id);
    const body = await req.json().catch(() => ({}));
    const normalized = normalizeDebriefSaveInput(body, allowedIds);
    const assistanceEnabled = await isCoachTrainingAssistanceEnabled(supabaseAdmin, event.club_id);
    assertCoachTrainingReportAllowed(assistanceEnabled, normalized.report_text);

    const saveRes = await supabaseAdmin.rpc("save_coach_training_debrief", {
      p_event_id: eventId,
      p_coach_id: callerId,
      p_report_text: normalized.report_text,
      p_report_scope: normalized.report_scope,
      p_reviews: normalized.reviews,
      p_update_report: assistanceEnabled,
    });
    if (saveRes.error) throw new Error(saveRes.error.message);

    return NextResponse.json({ ok: true, debriefId: saveRes.data });
  } catch (error: unknown) {
    if (error instanceof CoachDebriefValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Server error";
    const mapped = httpError(message);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
