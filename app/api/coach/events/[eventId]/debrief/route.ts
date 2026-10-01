import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import { isCoachTrainingAssistanceEnabled } from "@/lib/server/coachTrainingAssistance";
import { loadCoachEvaluationState } from "@/lib/server/coachEvaluation";

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

    const assistanceEnabled = await isCoachTrainingAssistanceEnabled(supabaseAdmin, event.club_id, callerId);
    const evaluationState = await loadCoachEvaluationState(supabaseAdmin, [eventId]);
    const [attendeesRes, feedbackRes, debriefRes, groupRes] = await Promise.all([
      supabaseAdmin
        .from("club_event_attendees")
        .select("player_id,coach_recorded_status,coach_recorded_by,coach_recorded_at")
        .eq("event_id", eventId),
      supabaseAdmin
        .from("club_event_coach_feedback")
        .select("player_id,engagement,attitude,performance,player_note,private_note")
        .eq("event_id", eventId),
      supabaseAdmin
        .from("coach_training_debriefs")
        .select("id,report_text,report_scope,collective_summary_text,individual_comments,report_version,author_coach_id,updated_at")
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
        player_note: string | null;
        private_note: string | null;
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
      debrief: debriefRes.data ?? null,
      coachTrainingAssistanceEnabled: assistanceEnabled,
      criteria: evaluationState.criteria.filter((criterion) => ["coach", "both"].includes(criterion.snapshot_respondent)),
      responses: evaluationState.responses,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const mapped = httpError(message);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

/** Retired collective save: use PUT /debrief/player for a reviewed participant. */
export async function PUT() {
  return NextResponse.json({ error: "Use the guided per-player evaluation.", code: "guided_evaluation_required" }, { status: 410 });
}
