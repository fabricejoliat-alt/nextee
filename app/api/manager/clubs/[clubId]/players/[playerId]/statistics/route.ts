import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import {
  calculateAttendance,
  benchmarkMedian,
  calculateProratedTrainingObjective,
  calculateRegularity,
  handicapProgression,
  percentChange,
  previousPeriod,
  uniqueTrainingRows,
  type DateRange,
} from "@/lib/playerStatistics";

export const runtime = "nodejs";

function validYmd(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()); }
function startIso(value: string) { return `${value}T00:00:00.000Z`; }
function endIso(value: string) { return `${value}T23:59:59.999Z`; }
function dateKey(value: string) { return String(value ?? "").slice(0, 10); }
function round1(value: number) { return Math.round(value * 10) / 10; }
function eventCategory(type: string | null) {
  if (type === "training") return "Entraînements";
  if (type === "interclub") return "Interclubs";
  if (type === "camp") return "Stages et camps";
  if (type === "competition") return "Compétitions du club";
  return "Autres activités";
}
function monthKey(value: string) { return String(value).slice(0, 7); }
function average(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? round1(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null;
}
function numericResponse(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object" && "value" in value) return numericResponse((value as { value: unknown }).value);
  return null;
}

async function authorize(db: any, callerId: string, clubId: string, playerId: string) {
  const [admin, manager, player] = await Promise.all([
    db.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", callerId).eq("role", "manager").eq("is_active", true).maybeSingle(),
    db.from("club_members").select("id,is_performance").eq("club_id", clubId).eq("user_id", playerId).eq("role", "player").eq("is_active", true).maybeSingle(),
  ]);
  if (player.error) throw new Error(player.error.message);
  if (!player.data) return { ok: false as const, status: 404, error: "Junior introuvable dans ce club." };
  if (!admin.data && !manager.data) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, isPerformance: Boolean(player.data.is_performance) };
}

function summarize(args: { attendanceRate: number | null; objectiveRate: number | null; regularityRate: number | null; handicapChange: number | null; samples: number }) {
  const parts: string[] = [];
  if (args.attendanceRate != null && args.samples >= 3) parts.push(`L’assiduité aux activités du club atteint ${args.attendanceRate.toLocaleString("fr-CH")} %.`);
  if (args.objectiveRate != null) parts.push(`Le volume enregistré représente ${Math.round(args.objectiveRate)} % du repère FTEM sur la période.`);
  if (args.handicapChange != null && args.handicapChange !== 0) parts.push(`Le handicap a ${args.handicapChange > 0 ? "progressé" : "évolué"} de ${Math.abs(args.handicapChange).toLocaleString("fr-CH")} point${Math.abs(args.handicapChange) > 1 ? "s" : ""}.`);
  if (parts.length < 3 && args.regularityRate != null) parts.push(`Une activité d’entraînement est enregistrée sur ${Math.round(args.regularityRate)} % des semaines.`);
  return parts.slice(0, 3).join(" ") || "Les données disponibles ne sont pas encore suffisantes pour dégager une synthèse fiable.";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string; playerId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { clubId, playerId } = await ctx.params;
    const from = String(req.nextUrl.searchParams.get("from") ?? "");
    const to = String(req.nextUrl.searchParams.get("to") ?? "");
    if (!validYmd(from) || !validYmd(to) || from > to) return NextResponse.json({ error: "Période invalide." }, { status: 400 });
    const range = { from, to };
    const benchmarkMode = String(req.nextUrl.searchParams.get("benchmark") ?? "none");
    const comparison = String(req.nextUrl.searchParams.get("comparison") ?? "previous");
    const compareRange = comparison === "none" ? null : comparison === "previous_season"
      ? { from: `${Number(range.from.slice(0, 4)) - 1}${range.from.slice(4)}`, to: `${Number(range.to.slice(0, 4)) - 1}${range.to.slice(4)}` }
      : previousPeriod(range);
    const earliest = compareRange?.from ?? range.from;
    const { supabaseAdmin: db, callerId } = await requireCaller(token);
    const access = await authorize(db, callerId, clubId, playerId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const [profile, attendeeRows, trainingRows, rounds, handicapRows, settings, targets, coachFeedback, playerFeedback, customLinks, customResponses] = await Promise.all([
      db.from("profiles").select("first_name,last_name,handicap").eq("id", playerId).maybeSingle(),
      db.from("club_event_attendees").select("event_id,status").eq("player_id", playerId).limit(5000),
      db.from("training_sessions").select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,club_id").eq("user_id", playerId).gte("start_at", startIso(earliest)).lte("start_at", endIso(range.to)).limit(5000),
      db.from("golf_rounds").select("id,start_at,round_type,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus,om_competition_level,om_points_net,om_points_brut").eq("user_id", playerId).gte("start_at", startIso(earliest)).lte("start_at", endIso(range.to)).limit(2000),
      db.from("player_handicap_history").select("effective_date,value").eq("user_id", playerId).lte("effective_date", range.to).order("effective_date"),
      db.from("training_volume_settings").select("season_months,offseason_months").eq("organization_id", clubId).maybeSingle(),
      db.from("training_volume_targets").select("ftem_code,level_label,handicap_min,handicap_max,minutes_offseason,minutes_inseason,sort_order").eq("organization_id", clubId).order("sort_order"),
      db.from("club_event_coach_feedback").select("event_id,engagement,attitude,performance,player_note,visible_to_player").eq("player_id", playerId).limit(3000),
      db.from("club_event_player_feedback").select("event_id,motivation,difficulty,satisfaction,submitted_at").eq("player_id", playerId).limit(3000),
      db.from("club_event_evaluation_criteria").select("id,event_id,snapshot_name,snapshot_response_format,snapshot_domain_label,snapshot_respondent").eq("club_id", clubId).eq("is_enabled", true).limit(3000),
      db.from("club_event_evaluation_responses").select("event_criterion_id,event_id,respondent_role,value_json,submitted_at").eq("club_id", clubId).eq("player_id", playerId).limit(6000),
    ]);
    for (const result of [profile, attendeeRows, trainingRows, rounds, handicapRows, settings, targets, coachFeedback, playerFeedback, customLinks, customResponses]) if (result.error) throw new Error(result.error.message);

    const eventIds = Array.from(new Set([
      ...(attendeeRows.data ?? []).map((row: any) => row.event_id),
      ...(coachFeedback.data ?? []).map((row: any) => row.event_id),
      ...(playerFeedback.data ?? []).map((row: any) => row.event_id),
      ...(customLinks.data ?? []).map((row: any) => row.event_id),
    ].filter(Boolean)));
    const eventsResult = eventIds.length ? await db.from("club_events").select("id,club_id,title,event_type,starts_at,ends_at,duration_minutes,status,requires_evaluation").in("id", eventIds).eq("club_id", clubId).gte("starts_at", startIso(earliest)).lte("starts_at", endIso(range.to)).limit(5000) : { data: [], error: null };
    if (eventsResult.error) throw new Error(eventsResult.error.message);
    const events = eventsResult.data ?? [];
    const eventById = new Map(events.map((event: any) => [String(event.id), event]));

    const sessionIds = (trainingRows.data ?? []).map((row: any) => row.id);
    const itemsResult = sessionIds.length ? await db.from("training_session_items").select("session_id,category,minutes").in("session_id", sessionIds).limit(10000) : { data: [], error: null };
    if (itemsResult.error) throw new Error(itemsResult.error.message);
    const minutesBySession = new Map<string, number>();
    for (const item of itemsResult.data ?? []) minutesBySession.set(String(item.session_id), (minutesBySession.get(String(item.session_id)) ?? 0) + Number(item.minutes ?? 0));

    const training = uniqueTrainingRows((trainingRows.data ?? []).filter((row: any) => row.club_id == null || row.club_id === clubId).map((row: any) => ({
      id: row.id, startAt: row.start_at, minutes: Number(row.total_minutes ?? minutesBySession.get(String(row.id)) ?? 0), sessionType: row.session_type, clubEventId: row.club_event_id,
    })));
    const attendance = (attendeeRows.data ?? []).map((row: any) => {
      const event: any = eventById.get(String(row.event_id));
      return event ? { id: event.id, startsAt: event.starts_at, status: row.status, eventStatus: event.status, eventType: event.event_type } : null;
    }).filter(Boolean);
    const handicapHistory = (handicapRows.data ?? []).map((row: any) => ({ effectiveDate: row.effective_date, value: Number(row.value) }));

    function metrics(period: DateRange) {
      const periodTraining = training.filter((row) => dateKey(row.startAt) >= period.from && dateKey(row.startAt) <= period.to);
      const periodAttendance = calculateAttendance(attendance, period);
      const regularity = calculateRegularity(periodTraining, period);
      const totalMinutes = periodTraining.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0);
      const periodRounds = (rounds.data ?? []).filter((row: any) => dateKey(row.start_at) >= period.from && dateKey(row.start_at) <= period.to);
      const competitionRounds = periodRounds.filter((row: any) => row.round_type === "competition");
      const objective = calculateProratedTrainingObjective({ range: period, seasonMonths: (settings.data?.season_months ?? []).map(Number), targets: (targets.data ?? []).map((row: any) => ({ ...row, handicap_min: row.handicap_min == null ? null : Number(row.handicap_min), handicap_max: row.handicap_max == null ? null : Number(row.handicap_max), minutes_offseason: Number(row.minutes_offseason ?? 0), minutes_inseason: Number(row.minutes_inseason ?? 0) })), handicapHistory, currentHandicap: typeof profile.data?.handicap === "number" ? profile.data.handicap : null });
      const hcp = handicapProgression(handicapHistory, period, typeof profile.data?.handicap === "number" ? profile.data.handicap : null);
      return { periodTraining, periodAttendance, regularity, totalMinutes, periodRounds, competitionRounds, objective, hcp };
    }
    const current = metrics(range);
    const previous = compareRange ? metrics(compareRange) : null;

    const categories = new Map<string, { minutes: number; sessions: Set<string> }>();
    const currentSessionIds = new Set(current.periodTraining.map((row) => row.id));
    for (const item of itemsResult.data ?? []) {
      if (!currentSessionIds.has(String(item.session_id))) continue;
      const key = String(item.category ?? "other");
      const entry = categories.get(key) ?? { minutes: 0, sessions: new Set<string>() };
      entry.minutes += Number(item.minutes ?? 0); entry.sessions.add(String(item.session_id)); categories.set(key, entry);
    }
    const byOrigin = ["club", "private", "individual"].map((origin) => {
      const rows = current.periodTraining.filter((row) => row.sessionType === origin);
      const minutes = rows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0);
      return { key: origin, minutes, sessions: rows.length, percentage: current.totalMinutes ? round1((minutes / current.totalMinutes) * 100) : null };
    });

    const attendanceByType = new Map<string, { invited: number; present: number }>();
    for (const row of attendance.filter((item: any) => dateKey(item.startsAt) >= range.from && dateKey(item.startsAt) <= range.to)) {
      const key = eventCategory((row as any).eventType);
      const item = attendanceByType.get(key) ?? { invited: 0, present: 0 };
      item.invited += 1; if ((row as any).status === "present") item.present += 1; attendanceByType.set(key, item);
    }
    const monthlyAttendance = Array.from(new Set(attendance.map((row: any) => monthKey(row.startsAt)))).filter((month) => month >= range.from.slice(0, 7) && month <= range.to.slice(0, 7)).sort().map((month) => {
      const itemRange = { from: `${month}-01`, to: `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, "0")}` };
      return { month, ...calculateAttendance(attendance, itemRange) };
    });

    const roundIds = current.periodRounds.map((row: any) => row.id);
    const holesResult = roundIds.length ? await db.from("golf_round_holes").select("round_id,hole_no,par,score,putts,fairway_hit").in("round_id", roundIds).limit(20000) : { data: [], error: null };
    if (holesResult.error) throw new Error(holesResult.error.message);
    const holes = holesResult.data ?? [];
    const documentedHoles = holes.filter((hole: any) => hole.score != null);
    const holesByRound = new Map<string, any[]>();
    for (const hole of holes) { const key = String(hole.round_id); const values = holesByRound.get(key) ?? []; values.push(hole); holesByRound.set(key, values); }
    const completedRounds = current.periodRounds.filter((round: any) => (holesByRound.get(String(round.id)) ?? []).filter((hole: any) => hole.score != null).length === 18);
    const score18 = completedRounds.map((round: any) => round.total_score ?? (holesByRound.get(String(round.id)) ?? []).reduce((sum: number, hole: any) => sum + Number(hole.score ?? 0), 0));
    const putts18 = completedRounds.map((round: any) => round.total_putts ?? (holesByRound.get(String(round.id)) ?? []).reduce((sum: number, hole: any) => sum + Number(hole.putts ?? 0), 0)).filter((entry: any) => Number(entry) > 0);
    const fairwayHoles = holes.filter((hole: any) => Number(hole.par) >= 4 && typeof hole.fairway_hit === "boolean");
    const girEligible = holes.filter((hole: any) => hole.par != null && hole.score != null && hole.putts != null);
    const isGir = (hole: any) => Number(hole.score) - Number(hole.putts) <= Number(hole.par) - 2;
    const girHits = girEligible.filter(isGir).length;
    const scramblingOpportunities = girEligible.filter((hole: any) => !isGir(hole));
    const scramblingSuccess = scramblingOpportunities.filter((hole: any) => Number(hole.score) <= Number(hole.par)).length;
    const averageForPar = (par: number) => average(holes.filter((hole: any) => Number(hole.par) === par && hole.score != null).map((hole: any) => Number(hole.score)));
    const averageForSide = (front: boolean) => average(holes.filter((hole: any) => hole.score != null && (front ? Number(hole.hole_no) <= 9 : Number(hole.hole_no) >= 10)).map((hole: any) => Number(hole.score)));
    const evaluationsEvents = events.filter((event: any) => event.requires_evaluation && dateKey(event.starts_at) >= range.from && dateKey(event.starts_at) <= range.to);
    const coachRows = (coachFeedback.data ?? []).filter((row: any) => evaluationsEvents.some((event: any) => event.id === row.event_id));
    const playerRows = (playerFeedback.data ?? []).filter((row: any) => evaluationsEvents.some((event: any) => event.id === row.event_id));
    const criterionById = new Map((customLinks.data ?? []).map((row: any) => [String(row.id), row]));
    const custom = (customResponses.data ?? []).filter((row: any) => {
      const event: any = eventById.get(String(row.event_id));
      return event && dateKey(event.starts_at) >= range.from && dateKey(event.starts_at) <= range.to;
    }).map((row: any) => ({ ...row, criterion: criterionById.get(String(row.event_criterion_id)) }));
    const perceptionGroups = new Map<string, { criterion: string; event: string; startsAt: string; player: number | null; coach: number | null }>();
    for (const response of custom) {
      const key = `${response.event_id}|${response.event_criterion_id}`;
      const event: any = eventById.get(String(response.event_id));
      const group = perceptionGroups.get(key) ?? { criterion: response.criterion?.snapshot_name ?? "Critère", event: event?.title ?? "Activité", startsAt: event?.starts_at ?? "", player: null, coach: null };
      const score = numericResponse(response.value_json);
      if (response.respondent_role === "coach") group.coach = score;
      if (response.respondent_role === "player") group.player = score;
      perceptionGroups.set(key, group);
    }
    const perceptionDifferences = Array.from(perceptionGroups.values()).filter((row) => row.player != null && row.coach != null).map((row) => ({ ...row, difference: round1((row.player as number) - (row.coach as number)) })).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const quality = {
      attendancePending: current.periodAttendance.pending,
      trainingsWithoutDuration: current.periodTraining.filter((row) => !Number(row.minutes ?? 0)).length,
      performanceSessionsIncomplete: access.isPerformance ? (trainingRows.data ?? []).filter((row: any) => dateKey(row.start_at) >= range.from && dateKey(row.start_at) <= range.to && (row.motivation == null || row.difficulty == null || row.satisfaction == null)).length : 0,
      playerEvaluationsMissing: Math.max(0, evaluationsEvents.length - playerRows.length),
      coachEvaluationsMissing: Math.max(0, evaluationsEvents.length - coachRows.length),
      competitionsWithoutResult: current.competitionRounds.filter((row: any) => row.total_score == null && row.om_points_net == null && row.om_points_brut == null).length,
      lowSample: current.periodAttendance.denominator < 3 || documentedHoles.length < 18,
      lastDataAt: [
        ...attendance.map((row: any) => row.startsAt), ...training.map((row) => row.startAt), ...(rounds.data ?? []).map((row: any) => row.start_at), ...handicapHistory.map((row) => row.effectiveDate),
      ].filter(Boolean).sort().at(-1) ?? null,
    };
    const objectiveRate = current.objective.minutes && current.objective.minutes > 0 ? round1((current.totalMinutes / current.objective.minutes) * 100) : null;
    let benchmark: { enabled: boolean; reason?: string; cohortSize?: number; values?: Record<string, number | null> } = { enabled: false };
    if (["club", "group", "ftem"].includes(benchmarkMode)) {
      const clubPlayers = await db.from("club_members").select("user_id").eq("club_id", clubId).eq("role", "player").eq("is_active", true).limit(2000);
      if (clubPlayers.error) throw new Error(clubPlayers.error.message);
      let cohortIds = (clubPlayers.data ?? []).map((row: any) => String(row.user_id));
      if (benchmarkMode === "group") {
        const ownGroups = await db.from("coach_group_players").select("group_id").eq("player_user_id", playerId);
        if (ownGroups.error) throw new Error(ownGroups.error.message);
        const groupIds = (ownGroups.data ?? []).map((row: any) => row.group_id);
        const peers = groupIds.length ? await db.from("coach_group_players").select("player_user_id").in("group_id", groupIds) : { data: [], error: null };
        if (peers.error) throw new Error(peers.error.message);
        const peerIds = new Set((peers.data ?? []).map((row: any) => String(row.player_user_id)));
        cohortIds = cohortIds.filter((id: string) => peerIds.has(id));
      }
      const cohortProfiles = cohortIds.length ? await db.from("profiles").select("id,handicap").in("id", cohortIds) : { data: [], error: null };
      if (cohortProfiles.error) throw new Error(cohortProfiles.error.message);
      if (benchmarkMode === "ftem") {
        cohortIds = (cohortProfiles.data ?? []).filter((row: any) => {
          const hcp = row.handicap == null ? null : Number(row.handicap);
          const match = (targets.data ?? []).find((target: any) => hcp != null && (target.handicap_min == null || hcp >= Number(target.handicap_min)) && (target.handicap_max == null || hcp <= Number(target.handicap_max)));
          return match?.ftem_code === current.objective.ftemCode;
        }).map((row: any) => String(row.id));
      }
      if (cohortIds.length < 5) benchmark = { enabled: false, cohortSize: cohortIds.length, reason: `Comparaison indisponible : la cohorte contient ${cohortIds.length} junior${cohortIds.length > 1 ? "s" : ""}, contre 5 minimum.` };
      else {
        const [cohortAttendanceRows, cohortTrainingRows] = await Promise.all([
          db.from("club_event_attendees").select("player_id,event_id,status").in("player_id", cohortIds).limit(20000),
          db.from("training_sessions").select("id,user_id,start_at,total_minutes,session_type,club_event_id,club_id").in("user_id", cohortIds).gte("start_at", startIso(range.from)).lte("start_at", endIso(range.to)).limit(20000),
        ]);
        if (cohortAttendanceRows.error || cohortTrainingRows.error) throw new Error(cohortAttendanceRows.error?.message ?? cohortTrainingRows.error?.message);
        const cohortEventIds = Array.from(new Set((cohortAttendanceRows.data ?? []).map((row: any) => row.event_id)));
        const cohortEvents = cohortEventIds.length ? await db.from("club_events").select("id,starts_at,status,event_type").in("id", cohortEventIds).eq("club_id", clubId).gte("starts_at", startIso(range.from)).lte("starts_at", endIso(range.to)).limit(10000) : { data: [], error: null };
        if (cohortEvents.error) throw new Error(cohortEvents.error.message);
        const cohortEventMap = new Map((cohortEvents.data ?? []).map((event: any) => [String(event.id), event]));
        const profileMap = new Map((cohortProfiles.data ?? []).map((row: any) => [String(row.id), row]));
        const attendanceRates: number[] = []; const regularityRates: number[] = []; const objectiveRates: number[] = []; const participation: number[] = [];
        for (const id of cohortIds) {
          const rows = (cohortAttendanceRows.data ?? []).filter((row: any) => String(row.player_id) === id).flatMap((row: any) => { const event: any = cohortEventMap.get(String(row.event_id)); return event ? [{ id: event.id, startsAt: event.starts_at, status: row.status, eventStatus: event.status, eventType: event.event_type }] : []; });
          const attendanceMetric = calculateAttendance(rows, range); if (attendanceMetric.rate != null) attendanceRates.push(attendanceMetric.rate); participation.push(attendanceMetric.present);
          const trainingMetric = uniqueTrainingRows((cohortTrainingRows.data ?? []).filter((row: any) => String(row.user_id) === id && (row.club_id == null || row.club_id === clubId)).map((row: any) => ({ id: row.id, startAt: row.start_at, minutes: Number(row.total_minutes ?? 0), sessionType: row.session_type, clubEventId: row.club_event_id })));
          const regularityMetric = calculateRegularity(trainingMetric, range); if (regularityMetric.rate != null) regularityRates.push(regularityMetric.rate);
          const hcp = profileMap.get(id)?.handicap == null ? null : Number(profileMap.get(id)?.handicap); const target = calculateProratedTrainingObjective({ range, seasonMonths: (settings.data?.season_months ?? []).map(Number), targets: (targets.data ?? []).map((row: any) => ({ ...row, handicap_min: row.handicap_min == null ? null : Number(row.handicap_min), handicap_max: row.handicap_max == null ? null : Number(row.handicap_max), minutes_offseason: Number(row.minutes_offseason ?? 0), minutes_inseason: Number(row.minutes_inseason ?? 0) })), handicapHistory: [], currentHandicap: hcp }); const total = trainingMetric.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0); if (target.minutes) objectiveRates.push(round1((total / target.minutes) * 100));
        }
        benchmark = { enabled: true, cohortSize: cohortIds.length, values: { attendanceRate: benchmarkMedian(attendanceRates).value, regularityRate: benchmarkMedian(regularityRates).value, objectiveRate: benchmarkMedian(objectiveRates).value, participation: benchmarkMedian(participation).value } };
      }
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(), range, comparison: compareRange,
      player: { id: playerId, name: `${profile.data?.first_name ?? ""} ${profile.data?.last_name ?? ""}`.trim(), isPerformance: access.isPerformance },
      summary: summarize({ attendanceRate: current.periodAttendance.rate, objectiveRate, regularityRate: current.regularity.rate, handicapChange: current.hcp.change, samples: current.periodAttendance.denominator }),
      overview: {
        attendance: current.periodAttendance,
        training: { minutes: current.totalMinutes, sessions: current.periodTraining.length, averageMinutes: current.periodTraining.length ? round1(current.totalMinutes / current.periodTraining.length) : null, weeklyAverageMinutes: current.regularity.totalWeeks ? round1(current.totalMinutes / current.regularity.totalWeeks) : null, objectiveMinutes: current.objective.minutes, objectiveRate, ftemCode: current.objective.ftemCode, ftemLabel: current.objective.ftemLabel, change: percentChange(current.totalMinutes, previous?.totalMinutes ?? null) },
        regularity: { ...current.regularity, change: current.regularity.rate != null && previous?.regularity.rate != null ? round1(current.regularity.rate - previous.regularity.rate) : null },
        handicap: current.hcp,
        play: { rounds: current.periodRounds.length, competitions: current.competitionRounds.length, holes: documentedHoles.length, results: current.periodRounds.filter((row: any) => row.total_score != null).length },
        evaluations: { expected: evaluationsEvents.length, coachCompleted: coachRows.length, playerCompleted: playerRows.length, completionRate: evaluationsEvents.length ? round1((coachRows.length / evaluationsEvents.length) * 100) : null },
      },
      attendance: { ...current.periodAttendance, previousRate: previous?.periodAttendance.rate ?? null, change: current.periodAttendance.rate != null && previous?.periodAttendance.rate != null ? round1(current.periodAttendance.rate - previous.periodAttendance.rate) : null, monthly: monthlyAttendance, byType: Array.from(attendanceByType, ([label, values]) => ({ label, ...values })) },
      training: { byOrigin, byCategory: Array.from(categories, ([key, value]) => ({ key, minutes: value.minutes, sessions: value.sessions.size, percentage: current.totalMinutes ? round1((value.minutes / current.totalMinutes) * 100) : null })), feelings: { motivation: average((trainingRows.data ?? []).filter((row: any) => dateKey(row.start_at) >= range.from && dateKey(row.start_at) <= range.to).map((row: any) => row.motivation)), difficulty: average((trainingRows.data ?? []).filter((row: any) => dateKey(row.start_at) >= range.from && dateKey(row.start_at) <= range.to).map((row: any) => row.difficulty)), satisfaction: average((trainingRows.data ?? []).filter((row: any) => dateKey(row.start_at) >= range.from && dateKey(row.start_at) <= range.to).map((row: any) => row.satisfaction)), completed: (trainingRows.data ?? []).filter((row: any) => dateKey(row.start_at) >= range.from && dateKey(row.start_at) <= range.to && row.motivation != null && row.difficulty != null && row.satisfaction != null).length } },
      play: { rounds: current.periodRounds, holes: documentedHoles.length, completedRounds: completedRounds.length, frequencyPerMonth: round1((current.periodRounds.length / Math.max(1, (new Date(`${range.to}T12:00:00Z`).getTime() - new Date(`${range.from}T12:00:00Z`).getTime()) / 86400000 + 1)) * 30.44), averageScore: average(score18), averagePutts: average(putts18), girRate: girEligible.length ? round1((girHits / girEligible.length) * 100) : null, girSample: girEligible.length, fairwayRate: fairwayHoles.length ? round1((fairwayHoles.filter((hole: any) => hole.fairway_hit).length / fairwayHoles.length) * 100) : null, fairwaySample: fairwayHoles.length, scramblingRate: scramblingOpportunities.length ? round1((scramblingSuccess / scramblingOpportunities.length) * 100) : null, scramblingSample: scramblingOpportunities.length, averagePar3: averageForPar(3), averagePar4: averageForPar(4), averagePar5: averageForPar(5), averageFront: averageForSide(true), averageBack: averageForSide(false), competitionLevels: Array.from(new Set(current.competitionRounds.map((row: any) => row.om_competition_level).filter(Boolean))), orderOfMeritPoints: current.competitionRounds.reduce((sum: number, row: any) => sum + Number(row.om_points_net ?? row.om_points_brut ?? 0), 0), scores: { eagles: current.periodRounds.reduce((sum: number, row: any) => sum + Number(row.eagles ?? 0), 0), birdies: current.periodRounds.reduce((sum: number, row: any) => sum + Number(row.birdies ?? 0), 0), pars: current.periodRounds.reduce((sum: number, row: any) => sum + Number(row.pars ?? 0), 0), bogeys: current.periodRounds.reduce((sum: number, row: any) => sum + Number(row.bogeys ?? 0), 0), doublesPlus: current.periodRounds.reduce((sum: number, row: any) => sum + Number(row.doubles_plus ?? 0), 0) } },
      evaluations: { events: evaluationsEvents.map((event: any) => ({ id: event.id, title: event.title, startsAt: event.starts_at })), coach: coachRows, player: playerRows, custom, perceptionDifferences },
      handicapHistory: handicapHistory.filter((entry) => entry.effectiveDate >= range.from && entry.effectiveDate <= range.to),
      quality,
      benchmark,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
