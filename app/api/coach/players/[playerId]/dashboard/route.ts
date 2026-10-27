import { isMatchPlayRound, type MatchPlayRound } from "@/lib/golfRoundPresentation";
import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";
import { coachRows } from "@/lib/server/coachRows";
import { dashboardTrainingPeriod, inDashboardPeriod, type DashboardSession, type DashboardItem, type DashboardEvent, type DashboardAttendance } from "@/lib/coachPlayerDashboard";

const ROUND_COLUMNS = "id,start_at,round_type,om_competition_format,om_match_result,match_score_text,score_entry_mode,competition_name,course_name,location,tee_name,handicap_start,slope_rating,course_rating,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus";
type Round = MatchPlayRound & { id: string; start_at: string };
type Hole = { round_id: string; hole_no: number; par: number | null; score: number | null; putts: number | null; fairway_hit: boolean | null };

function validDate(value: string) {
  const time = Date.parse(`${value}T00:00:00Z`);
  return !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value);
}

/** Authenticate and authorize once; read bounded pages without repeating browser RLS joins for every chart. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    const params = req.nextUrl.searchParams;
    const view = params.get("view") ?? "overview";
    if (!["overview", "trainings", "stats", "competition"].includes(view)) return NextResponse.json({ error: "Invalid view" }, { status: 400 });
    const period = { from: params.get("from") ?? "", to: params.get("to") ?? "" };
    const previous = { from: params.get("prev_from") ?? "", to: params.get("prev_to") ?? "" };
    if (![period.from, period.to, previous.from, previous.to].every(validDate)
      || (period.from && period.to && period.from > period.to) || (previous.from && previous.to && previous.from > previous.to)
      || Boolean(previous.from) !== Boolean(previous.to)) return NextResponse.json({ error: "Période invalide." }, { status: 400 });
    const { supabaseAdmin: db, callerId } = await requireCaller(token);
    const access = await resolveCoachPlayerAccess(db, callerId, playerId, requestedOrganizationId(req.url));
    if (!access.sharedClubIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const scope = personalOrOrganizationFilter("club_id", access.sharedClubIds);
    const hasPrevious = Boolean(previous.from && previous.to);
    const earliest = period.from ? [period.from, ...(hasPrevious ? [previous.from] : [])].sort()[0] : "";
    const latest = period.to ? [period.to, ...(hasPrevious ? [previous.to] : [])].sort().at(-1)! : "";
    const training = view === "overview" || view === "trainings";
    const detailedRounds = view === "stats" || view === "competition";
    const allRounds = view === "competition";
    const bounded = <T extends { gte: (key: string, value: string) => T; lt: (key: string, value: string) => T }>(query: T, key: string) => {
      if (earliest) query = query.gte(key, `${earliest}T00:00:00Z`);
      if (latest) query = query.lt(key, new Date(Date.parse(`${latest}T00:00:00Z`) + 86_400_000).toISOString());
      return query;
    };
    const [sessions, attendance, performanceResult, loadedRounds] = await Promise.all([
      training ? coachRows<DashboardSession>((from, to) => bounded(db.from("training_sessions")
        .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,club_id,coach_user_id")
        .eq("user_id", playerId).or(scope), "start_at").order("start_at").order("id").range(from, to)) : [],
      training ? coachRows<DashboardAttendance>((from, to) => db.from("club_event_attendees")
        .select("event_id,status,coach_recorded_status").eq("player_id", playerId).order("event_id").range(from, to)) : [],
      training ? db.from("club_members").select("id").eq("user_id", playerId).in("club_id", access.sharedClubIds)
        .eq("role", "player").eq("is_active", true).eq("is_performance", true).limit(1) : { data: [], error: null },
      coachRows<Round>((from, to) => {
        let query = db.from("golf_rounds").select(ROUND_COLUMNS).eq("user_id", playerId).or(scope);
        if (!allRounds) query = bounded(query, "start_at");
        return query.order("start_at").order("id").range(from, to);
      }),
    ]);
    const rounds = allRounds ? loadedRounds : loadedRounds.filter(round => !isMatchPlayRound(round));
    if (performanceResult.error) throw new Error(performanceResult.error.message);
    const performance = Boolean(performanceResult.data?.length);
    const items: DashboardItem[] = [];
    const events: DashboardEvent[] = [];
    const holes: Hole[] = [];
    await Promise.all([
      (async () => {
        for (let index = 0; index < sessions.length; index += 100) {
          items.push(...await coachRows<DashboardItem>((from, to) => db.from("training_session_items")
            .select("session_id,category,minutes").in("session_id", sessions.slice(index, index + 100).map(row => row.id))
            .order("session_id").order("id").range(from, to)));
        }
      })(),
      (async () => {
        for (let index = 0; index < attendance.length; index += 100) {
          events.push(...await coachRows<DashboardEvent>((from, to) => bounded(db.from("club_events")
            .select("id,club_id,starts_at,ends_at,duration_minutes,status,event_type")
            .in("id", attendance.slice(index, index + 100).map(row => row.event_id)).in("club_id", access.sharedClubIds)
            .neq("status", "cancelled").lt("starts_at", new Date().toISOString()), "starts_at")
            .order("starts_at").order("id").range(from, to)));
        }
      })(),
      (async () => {
        if (!detailedRounds) return;
        for (let index = 0; index < rounds.length; index += 100) {
          holes.push(...await coachRows<Hole>((from, to) => db.from("golf_round_holes")
            .select("round_id,hole_no,par,score,putts,fairway_hit").in("round_id", rounds.slice(index, index + 100).map(row => row.id))
            .order("round_id").order("hole_no").range(from, to)));
        }
      })(),
    ]);
    const trainingArgs = { sessions, items, events, attendance, performance };
    const currentRounds = rounds.filter(row => allRounds || inDashboardPeriod(row.start_at, period));
    const previousRounds = !allRounds && hasPrevious ? rounds.filter(row => inDashboardPeriod(row.start_at, previous)) : [];
    const currentIds = new Set(currentRounds.map(row => row.id));
    const previousIds = new Set(previousRounds.map(row => row.id));
    return NextResponse.json({
      training: training ? { current: dashboardTrainingPeriod({ ...trainingArgs, period }),
        previous: hasPrevious ? dashboardTrainingPeriod({ ...trainingArgs, period: previous }) : null } : null,
      rounds: currentRounds, prevRounds: previousRounds,
      holes: holes.filter(row => currentIds.has(row.round_id)), prevHoles: holes.filter(row => previousIds.has(row.round_id)),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Coach player dashboard read failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Impossible de charger les statistiques du junior. Réessayez." }, { status: error instanceof Error && error.message === "Invalid token" ? 401 : 500 });
  }
}
