export type DateRange = { from: string; to: string };
export type AttendanceStatus = "present" | "absent" | "excused" | "expected" | "not_registered" | string | null;

export type AttendanceInput = {
  id: string;
  startsAt: string;
  status: AttendanceStatus;
  eventStatus?: string | null;
  eventType?: string | null;
};

export type TrainingInput = {
  id: string;
  startAt: string;
  minutes: number | null;
  sessionType?: "club" | "private" | "individual" | string | null;
  clubEventId?: string | null;
};

const DAY = 86_400_000;

export function inclusiveDays(range: DateRange) {
  return Math.max(1, Math.floor((new Date(`${range.to}T12:00:00Z`).getTime() - new Date(`${range.from}T12:00:00Z`).getTime()) / DAY) + 1);
}

export function previousPeriod(range: DateRange): DateRange {
  const days = inclusiveDays(range);
  const previousTo = new Date(`${range.from}T12:00:00Z`);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - days + 1);
  return { from: previousFrom.toISOString().slice(0, 10), to: previousTo.toISOString().slice(0, 10) };
}

export function calculateAttendance(rows: AttendanceInput[], range: DateRange, now = new Date()) {
  const usable = rows.filter((row) => {
    const ymd = row.startsAt.slice(0, 10);
    return ymd >= range.from && ymd <= range.to && new Date(row.startsAt) < now && row.eventStatus !== "cancelled" && row.status !== "not_registered";
  });
  const present = usable.filter((row) => row.status === "present").length;
  const absent = usable.filter((row) => row.status === "absent").length;
  const excused = usable.filter((row) => row.status === "excused").length;
  const pending = usable.filter((row) => !row.status || row.status === "expected").length;
  const denominator = present + absent;
  return {
    invited: usable.length,
    present,
    absent,
    excused,
    pending,
    rate: denominator > 0 ? Math.round((present / denominator) * 1000) / 10 : null,
    denominator,
  };
}

function mondayKey(value: string) {
  const date = new Date(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function calculateRegularity(rows: TrainingInput[], range: DateRange) {
  const rangeStart = new Date(`${range.from}T00:00:00Z`);
  const rangeEnd = new Date(`${range.to}T23:59:59Z`);
  const weekKeys: string[] = [];
  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const key = mondayKey(cursor.toISOString());
    if (!weekKeys.includes(key)) weekKeys.push(key);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const active = new Set(rows.filter((row) => {
    const date = new Date(row.startAt);
    return date >= rangeStart && date <= rangeEnd && Number(row.minutes ?? 0) > 0;
  }).map((row) => mondayKey(row.startAt)));
  let longest = 0;
  let streak = 0;
  for (const week of weekKeys) {
    if (active.has(week)) { streak += 1; longest = Math.max(longest, streak); }
    else streak = 0;
  }
  return {
    totalWeeks: weekKeys.length,
    activeWeeks: weekKeys.filter((week) => active.has(week)).length,
    inactiveWeeks: weekKeys.filter((week) => !active.has(week)).length,
    longestStreak: longest,
    rate: weekKeys.length ? Math.round((active.size / weekKeys.length) * 1000) / 10 : null,
  };
}

export function uniqueTrainingRows(rows: TrainingInput[]) {
  const eventIds = new Set(rows.filter((row) => row.clubEventId).map((row) => row.clubEventId));
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.clubEventId ? `event:${row.clubEventId}` : `session:${row.id}`;
    if (row.clubEventId && !eventIds.has(row.clubEventId)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function median(values: Array<number | null | undefined>) {
  const sorted = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function benchmarkMedian(values: Array<number | null | undefined>, minimum = 5) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return { cohortSize: usable.length, value: usable.length >= minimum ? median(usable) : null, available: usable.length >= minimum };
}

export function handicapProgression(entries: Array<{ effectiveDate: string; value: number }>, range: DateRange, current: number | null) {
  const ordered = [...entries].filter((entry) => entry.effectiveDate <= range.to).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const beforeOrAtStart = ordered.filter((entry) => entry.effectiveDate <= range.from).at(-1);
  const within = ordered.filter((entry) => entry.effectiveDate >= range.from && entry.effectiveDate <= range.to);
  const start = beforeOrAtStart?.value ?? within[0]?.value ?? null;
  const end = within.at(-1)?.value ?? current;
  const bestValues = [...within.map((entry) => entry.value), ...(start == null ? [] : [start]), ...(end == null ? [] : [end])];
  return {
    start,
    end,
    best: bestValues.length ? Math.min(...bestValues) : null,
    change: start != null && end != null ? Math.round((start - end) * 10) / 10 : null,
    reliable: within.length > 0 || beforeOrAtStart != null,
  };
}

export function percentChange(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export type TrainingTarget = { ftem_code: string; level_label: string; handicap_min: number | null; handicap_max: number | null; minutes_offseason: number; minutes_inseason: number };
export function calculateProratedTrainingObjective(args: { range: DateRange; seasonMonths: number[]; targets: TrainingTarget[]; handicapHistory: Array<{ effectiveDate: string; value: number }>; currentHandicap: number | null }) {
  const history = [...args.handicapHistory].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  let minutes = 0; let lastTarget: TrainingTarget | null = null;
  const cursor = new Date(`${args.range.from}T12:00:00Z`); const end = new Date(`${args.range.to}T12:00:00Z`);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const known = history.filter((entry) => entry.effectiveDate <= date).at(-1)?.value ?? args.currentHandicap;
    const target = known == null ? null : args.targets.find((row) => {
      if (row.handicap_min == null || row.handicap_max == null) return false;
      return known >= Math.min(row.handicap_min, row.handicap_max) && known <= Math.max(row.handicap_min, row.handicap_max);
    }) ?? null;
    if (target) {
      const days = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
      minutes += (args.seasonMonths.includes(cursor.getUTCMonth() + 1) ? target.minutes_inseason : target.minutes_offseason) / days;
      lastTarget = target;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { minutes: lastTarget ? Math.round(minutes) : null, ftemCode: lastTarget?.ftem_code ?? null, ftemLabel: lastTarget?.level_label ?? null };
}
