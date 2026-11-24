import type { DateRange, TrainingTarget } from "./playerStatistics";

export function pickTrainingVolumeTarget<T extends Pick<TrainingTarget, "handicap_min" | "handicap_max">>(handicap: number | null | undefined, rows: T[]): T | null {
  if (!rows.length) return null;
  if (typeof handicap !== "number" || !Number.isFinite(handicap)) return rows[0];
  return rows.find(row => typeof row.handicap_min === "number" && typeof row.handicap_max === "number"
    && handicap >= Math.min(row.handicap_min, row.handicap_max) && handicap <= Math.max(row.handicap_min, row.handicap_max)) ?? rows[0];
}

export function objectiveForMonth(target: Pick<TrainingTarget, "minutes_inseason" | "minutes_offseason"> | null, seasonMonths: number[], offseasonMonths: number[], month: number) {
  if (!target) return 0;
  return seasonMonths.includes(month) || (!offseasonMonths.includes(month) && seasonMonths.length > 0) ? target.minutes_inseason : target.minutes_offseason;
}

export type TrainingVolumeConfig = { organizationId?: string; targets: TrainingTarget[]; seasonMonths: number[]; offseasonMonths: number[] };
export type WeeklyTrainingObjective = { configs: TrainingVolumeConfig[]; handicapHistory: Array<{ effectiveDate: string; value: number }>; currentHandicap: number | null };

export function trainingHandicapForDate(date: string, history: WeeklyTrainingObjective["handicapHistory"], current: number | null) {
  const sorted = [...history].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return sorted.filter(row => row.effectiveDate <= date).at(-1)?.value ?? sorted[0]?.value ?? current;
}

/** Player uses the Monday's handicap and season, with the maximum affiliated weekly reference. */
export function trainingReferenceForWeek(week: string, objective: WeeklyTrainingObjective) {
  const handicap = trainingHandicapForDate(week, objective.handicapHistory, objective.currentHandicap);
  let minutes = 0;
  let target: TrainingTarget | null = null;
  for (const config of objective.configs) {
    const candidate = pickTrainingVolumeTarget(handicap, config.targets);
    const value = objectiveForMonth(candidate, config.seasonMonths, config.offseasonMonths, Number(week.slice(5, 7)));
    if (value > minutes) { minutes = value; target = candidate; }
  }
  return { minutes: minutes > 0 ? minutes : null, ftemCode: target?.ftem_code ?? null, ftemLabel: target?.level_label ?? null };
}

/** Full weekly references, including the first and last partial weeks, as on Player. */
export function calculateWeeklyTrainingObjective(range: DateRange, objective: WeeklyTrainingObjective) {
  const cursor = new Date(`${range.from}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  let minutes = 0;
  let reference: ReturnType<typeof trainingReferenceForWeek> = { minutes: null, ftemCode: null, ftemLabel: null };
  while (cursor.toISOString().slice(0, 10) <= range.to) {
    reference = trainingReferenceForWeek(cursor.toISOString().slice(0, 10), objective);
    minutes += reference.minutes ?? 0;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return { minutes: minutes > 0 ? minutes : null, ftemCode: reference.ftemCode, ftemLabel: reference.ftemLabel };
}
