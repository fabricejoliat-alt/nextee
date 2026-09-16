import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateAttendance, calculateProratedTrainingObjective, calculateRegularity, handicapProgression, uniqueTrainingRows } from "@/lib/playerStatistics";
import { periodLabel, periodicEventTitle, previousCivilPeriod, type ReportFrequency } from "@/lib/periodicReports";

export const defaultPeriodicReportSections = { attendance: true, training: true, competitions: true, handicap: true, evaluations: true, coach_comment: true, upcoming: true };

type ReportConfig = {
  club_id: string;
  player_user_id: string;
  frequency: ReportFrequency;
  locale?: string;
  sections?: Record<string, boolean>;
  coach_priority?: string | null;
  coach_objective?: string | null;
  coach_encouragement?: string | null;
  coach_comment?: string | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const average = (values: Array<number | null | undefined>) => {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? round1(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null;
};

export async function buildPeriodicReportContent(db: SupabaseClient, config: ReportConfig, suppliedPeriod?: { from: string; to: string }) {
  const period = suppliedPeriod ?? previousCivilPeriod(config.frequency);
  const sections = { ...defaultPeriodicReportSections, ...(config.sections ?? {}) };
  const [profile, attendanceRows, trainingsResult, rounds, handicaps, club, settings, targets, coachFeedback] = await Promise.all([
    db.from("profiles").select("first_name,last_name,handicap").eq("id", config.player_user_id).maybeSingle(),
    db.from("club_event_attendees").select("event_id,status").eq("player_id", config.player_user_id).limit(5000),
    db.from("training_sessions").select("id,start_at,total_minutes,session_type,club_event_id,club_id,motivation,difficulty,satisfaction").eq("user_id", config.player_user_id).gte("start_at", `${period.from}T00:00:00Z`).lte("start_at", `${period.to}T23:59:59Z`).limit(5000),
    db.from("golf_rounds").select("id,start_at,round_type,total_score,total_putts,gir,fairways_hit,fairways_total,eagles,birdies,pars,bogeys,doubles_plus").eq("user_id", config.player_user_id).gte("start_at", `${period.from}T00:00:00Z`).lte("start_at", `${period.to}T23:59:59Z`).limit(2000),
    db.from("player_handicap_history").select("effective_date,value").eq("user_id", config.player_user_id).lte("effective_date", period.to).order("effective_date"),
    db.from("clubs").select("name").eq("id", config.club_id).maybeSingle(),
    db.from("training_volume_settings").select("season_months,offseason_months").eq("organization_id", config.club_id).maybeSingle(),
    db.from("training_volume_targets").select("ftem_code,level_label,handicap_min,handicap_max,minutes_offseason,minutes_inseason,sort_order").eq("organization_id", config.club_id).order("sort_order"),
    db.from("club_event_coach_feedback").select("event_id,engagement,attitude,performance,visible_to_player").eq("player_id", config.player_user_id).limit(3000),
  ]);
  for (const result of [profile, attendanceRows, trainingsResult, rounds, handicaps, club, settings, targets, coachFeedback]) if (result.error) throw new Error(result.error.message);

  const attendeeEventIds = (attendanceRows.data ?? []).map((row) => String(row.event_id));
  const nowIso = new Date().toISOString();
  const [periodEvents, upcomingEvents] = await Promise.all([
    attendeeEventIds.length ? db.from("club_events").select("id,title,event_type,starts_at,status").in("id", attendeeEventIds).eq("club_id", config.club_id).gte("starts_at", `${period.from}T00:00:00Z`).lte("starts_at", `${period.to}T23:59:59Z`) : Promise.resolve({ data: [], error: null }),
    attendeeEventIds.length ? db.from("club_events").select("id,title,event_type,starts_at,status").in("id", attendeeEventIds).eq("club_id", config.club_id).gte("starts_at", nowIso).neq("status", "cancelled").order("starts_at").limit(5) : Promise.resolve({ data: [], error: null }),
  ]);
  if (periodEvents.error || upcomingEvents.error) throw new Error(periodEvents.error?.message ?? upcomingEvents.error?.message);
  const eventMap = new Map((periodEvents.data ?? []).map((row) => [String(row.id), row]));
  const attendanceInput = (attendanceRows.data ?? []).flatMap((row) => {
    const event = eventMap.get(String(row.event_id));
    return event ? [{ id: String(event.id), startsAt: String(event.starts_at), status: String(row.status), eventStatus: String(event.status), eventType: String(event.event_type ?? "") }] : [];
  });
  const attendance = calculateAttendance(attendanceInput, period);

  const sessionRows = uniqueTrainingRows((trainingsResult.data ?? []).filter((row) => row.club_id == null || row.club_id === config.club_id).map((row) => ({ id: String(row.id), startAt: String(row.start_at), minutes: Number(row.total_minutes ?? 0), sessionType: row.session_type == null ? null : String(row.session_type), clubEventId: row.club_event_id == null ? null : String(row.club_event_id) })));
  const minutes = sessionRows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0);
  const regularity = calculateRegularity(sessionRows, period);
  const handicapHistory = (handicaps.data ?? []).map((row) => ({ effectiveDate: String(row.effective_date), value: Number(row.value) })).filter((row) => Number.isFinite(row.value));
  const currentHandicap = typeof profile.data?.handicap === "number" ? profile.data.handicap : null;
  const handicap = handicapProgression(handicapHistory, period, currentHandicap);
  const objective = calculateProratedTrainingObjective({
    range: period,
    seasonMonths: (settings.data?.season_months ?? []).map(Number),
    targets: (targets.data ?? []).map((row) => ({ ...row, handicap_min: row.handicap_min == null ? null : Number(row.handicap_min), handicap_max: row.handicap_max == null ? null : Number(row.handicap_max), minutes_offseason: Number(row.minutes_offseason ?? 0), minutes_inseason: Number(row.minutes_inseason ?? 0) })),
    handicapHistory,
    currentHandicap,
  });
  const objectiveRate = objective.minutes && objective.minutes > 0 ? round1((minutes / objective.minutes) * 100) : null;
  const competitionRows = (rounds.data ?? []).filter((row) => row.round_type === "competition");
  const feedbackEventIds = new Set((periodEvents.data ?? []).map((event) => String(event.id)));
  const feedback = (coachFeedback.data ?? []).filter((row) => feedbackEventIds.has(String(row.event_id)));
  const evaluationSample = feedback.length;
  const evaluation = evaluationSample >= 3 ? {
    sample: evaluationSample,
    engagement: average(feedback.map((row) => row.engagement == null ? null : Number(row.engagement))),
    attitude: average(feedback.map((row) => row.attitude == null ? null : Number(row.attitude))),
    application: average(feedback.map((row) => row.performance == null ? null : Number(row.performance))),
  } : null;
  const feelings = (trainingsResult.data ?? []).filter((row) => row.motivation != null && row.difficulty != null && row.satisfaction != null);
  const name = `${profile.data?.first_name ?? ""} ${profile.data?.last_name ?? ""}`.trim() || "Junior";
  const facts = [
    attendance.denominator ? `${attendance.present} présence${attendance.present > 1 ? "s" : ""} sur ${attendance.denominator} activité${attendance.denominator > 1 ? "s" : ""} comptabilisée${attendance.denominator > 1 ? "s" : ""}` : null,
    minutes ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} d’entraînement enregistrées` : null,
    competitionRows.length ? `${competitionRows.length} compétition${competitionRows.length > 1 ? "s" : ""}` : null,
    handicap.change ? `un handicap passé de ${handicap.start} à ${handicap.end}` : null,
  ].filter((fact): fact is string => Boolean(fact));

  return {
    clubName: club.data?.name ?? "Club",
    playerName: name,
    period,
    periodLabel: periodLabel(period, config.locale),
    summary: facts.length ? `Durant cette période, ${name} compte ${facts.slice(0, 3).join(", ")}.` : `Aucune donnée suffisante n’est disponible pour résumer cette période de ${name}.`,
    sections: {
      attendance: sections.attendance ? { invited: attendance.invited, present: attendance.present, absent: attendance.absent, excused: attendance.excused, pending: attendance.pending, rate: attendance.rate } : null,
      training: sections.training ? { sessions: sessionRows.length, minutes, regularityRate: regularity.rate, objectiveMinutes: objective.minutes, objectiveRate, byOrigin: Array.from(new Set(sessionRows.map((row) => row.sessionType ?? "individual"))).map((key) => ({ key, sessions: sessionRows.filter((row) => (row.sessionType ?? "individual") === key).length })) , feelings: feelings.length >= 3 ? { sample: feelings.length, motivation: average(feelings.map((row) => Number(row.motivation))), satisfaction: average(feelings.map((row) => Number(row.satisfaction))) } : null } : null,
      competitions: sections.competitions ? { competitions: competitionRows.length, rounds: rounds.data?.length ?? 0, results: (rounds.data ?? []).filter((row) => row.total_score != null).length, holes: (rounds.data ?? []).reduce((sum, row) => sum + (Number(row.total_score ?? 0) > 0 ? 18 : 0), 0) } : null,
      handicap: sections.handicap ? { ...handicap, best: handicapHistory.length ? Math.min(...handicapHistory.filter((row) => row.effectiveDate >= period.from).map((row) => row.value)) : handicap.end, ftemCode: objective.ftemCode, ftemLabel: objective.ftemLabel } : null,
      evaluations: sections.evaluations ? evaluation : null,
      upcoming: sections.upcoming ? (upcomingEvents.data ?? []).map((event) => ({ id: event.id, title: periodicEventTitle(event.title, event.event_type, config.locale), type: event.event_type, startsAt: event.starts_at })).slice(0, 5) : null,
      nextPeriod: { priority: config.coach_priority ?? null, objective: config.coach_objective ?? null, encouragement: config.coach_encouragement ?? null },
      coachComment: sections.coach_comment ? config.coach_comment ?? null : null,
    },
  };
}
