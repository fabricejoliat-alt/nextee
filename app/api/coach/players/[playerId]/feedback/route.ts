import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { coachRows } from "@/lib/server/coachRows";
import { activeCoachMemberships } from "@/lib/coachAccess";
import type { CoachFollowupEvent, CoachFollowupSelfEvaluation, CoachFollowupCriterion, CoachFollowupResponse, CoachFollowupAttendance } from "@/lib/coachPlayerFollowup";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

/** Private feedback is never fetched directly with the browser's database role. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    const { supabaseAdmin, callerId } = await requireCaller(token);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId,requestedOrganizationId(req.url));
    if (!access.sensitiveClubIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [references, attendance, privateReferences, memberships] = await Promise.all([
      coachRows<{ event_id: string }>((from, to) => supabaseAdmin.from("club_event_coach_feedback").select("event_id")
        .eq("player_id", playerId).order("event_id").order("coach_id").range(from, to)),
      coachRows<CoachFollowupAttendance>((from, to) => supabaseAdmin.from("club_event_attendees")
        .select("event_id,status,coach_recorded_status").eq("player_id", playerId).order("event_id").range(from, to)),
      coachRows<{ event_id: string }>((from, to) => supabaseAdmin.from("coach_player_private_notes").select("event_id")
        .eq("player_id", playerId).in("organization_id", access.sensitiveClubIds).order("id").range(from, to)),
      activeCoachMemberships(supabaseAdmin, callerId),
    ]);
    const referencedIds = [...new Set([...references, ...attendance, ...privateReferences].map((row) => row.event_id))];
    const events: CoachFollowupEvent[] = [];
    for (let index = 0; index < referencedIds.length; index += 150) {
      events.push(...await coachRows<CoachFollowupEvent>((from, to) => supabaseAdmin.from("club_events")
        .select("id,starts_at,ends_at,event_type,status,club_id,title,group_id,location_text")
        .in("id", referencedIds.slice(index, index + 150)).in("club_id", access.sensitiveClubIds)
        .neq("status", "cancelled").lt("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: false }).order("id").range(from, to)));
    }
    const eventIds = events.map((event) => event.id);
    type Feedback = { event_id: string; coach_id: string; engagement: number | null; attitude: number | null; performance: number | null; private_note: string | null; player_note: string | null };
    const feedback: Feedback[] = [];
    const selfEvaluations: CoachFollowupSelfEvaluation[] = [];
    const criteria: CoachFollowupCriterion[] = [];
    const responses: CoachFollowupResponse[] = [];
    for (let index = 0; index < eventIds.length; index += 150) {
      const ids = eventIds.slice(index, index + 150);
      const [fb, self, cr, answers] = await Promise.all([
        coachRows<Feedback>((from, to) => supabaseAdmin.from("club_event_coach_feedback")
          .select("event_id,coach_id,engagement,attitude,performance,private_note,player_note")
          .eq("player_id", playerId).in("event_id", ids).order("event_id").order("coach_id").range(from, to)),
        coachRows<CoachFollowupSelfEvaluation>((from, to) => supabaseAdmin.from("training_sessions")
          .select("id,club_event_id,motivation,difficulty,satisfaction,notes").eq("user_id", playerId)
          .in("club_event_id", ids).order("start_at", { ascending: false }).order("id").range(from, to)),
        coachRows<CoachFollowupCriterion>((from, to) => supabaseAdmin.from("club_event_evaluation_criteria")
          .select("event_id,id,snapshot_name,snapshot_choices").eq("is_enabled", true).in("event_id", ids)
          .order("event_id").order("position").order("id").range(from, to)),
        coachRows<CoachFollowupResponse>((from, to) => supabaseAdmin.from("club_event_evaluation_responses")
          .select("event_id,event_criterion_id,respondent_role,value_json").eq("player_id", playerId)
          .in("event_id", ids).order("event_id").order("id").range(from, to)),
      ]);
      feedback.push(...fb); selfEvaluations.push(...self); criteria.push(...cr); responses.push(...answers);
    }
    const groupIds = [...new Set(events.map((event) => event.group_id).filter(Boolean))];
    const groups = groupIds.length ? await supabaseAdmin.from("coach_groups").select("id,name").in("id", groupIds) : { data: [], error: null };
    const clubs = await supabaseAdmin.from("organizations").select("id,name").in("id", access.sensitiveClubIds);
    if (groups.error || clubs.error) throw new Error("Metadata load failed");
    const groupNames = new Map((groups.data ?? []).map((group) => [group.id, group.name]));
    const clubNames = new Map((clubs.data ?? []).map((club) => [club.id, club.name]));
    return NextResponse.json({
      feedback, selfEvaluations, criteria, responses,
      attendance: attendance.filter((row) => eventIds.includes(row.event_id)),
      events: events.sort((a, b) => b.starts_at.localeCompare(a.starts_at)).map((event) => ({
        ...event, group_name: groupNames.get(event.group_id) ?? null, organization_name: clubNames.get(event.club_id) ?? null,
        can_open_detail: memberships.some((row) => row.club_id === event.club_id && row.role === "manager")
          || access.sharedGroupIds.includes(event.group_id) || access.sharedEventIds.includes(event.id),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: message === "Invalid token" ? 401 : 500 });
  }
}
