export const PERFORMANCE_THRESHOLDS = {
  attendanceSample: 5,
  assiduousRate: 85,
  attendanceDropPoints: 15,
  trendSample: 3,
  coachEvaluationOverdueDays: 7,
  recentActivityDays: 30,
  objectiveFarBelowRate: 60,
} as const;

export function median(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

export function round1(value: number) { return Math.round(value * 10) / 10; }
export function percentage(numerator: number, denominator: number) { return denominator > 0 ? round1((numerator / denominator) * 100) : null; }

export function attendanceTrend(current: { rate: number | null; denominator: number }, previous: { rate: number | null; denominator: number }) {
  if (current.rate == null || previous.rate == null || current.denominator < PERFORMANCE_THRESHOLDS.trendSample || previous.denominator < PERFORMANCE_THRESHOLDS.trendSample) return { status: "insufficient" as const, change: null };
  const change = round1(current.rate - previous.rate);
  if (change <= -PERFORMANCE_THRESHOLDS.attendanceDropPoints) return { status: "down" as const, change };
  if (change >= PERFORMANCE_THRESHOLDS.attendanceDropPoints) return { status: "up" as const, change };
  return { status: "stable" as const, change };
}

export function isAssiduous(attendance: { rate: number | null; denominator: number }) {
  return attendance.rate != null && attendance.rate >= PERFORMANCE_THRESHOLDS.assiduousRate && attendance.denominator >= PERFORMANCE_THRESHOLDS.attendanceSample;
}

export function eventMinutes(event: { durationMinutes?: number | null; startsAt: string; endsAt?: string | null }) {
  if (typeof event.durationMinutes === "number" && event.durationMinutes >= 0) return event.durationMinutes;
  if (!event.endsAt) return 0;
  const value = Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60000);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateActivityAndCoachHours(events: Array<{ id: string; durationMinutes?: number | null; startsAt: string; endsAt?: string | null }>, assignments: Array<{ eventId: string; coachId: string }>) {
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const uniqueActivityMinutes = events.reduce((sum, event) => sum + eventMinutes(event), 0);
  const coachMinutes = assignments.reduce((sum, assignment) => sum + (eventMap.has(assignment.eventId) ? eventMinutes(eventMap.get(assignment.eventId)!) : 0), 0);
  return { activityHours: round1(uniqueActivityMinutes / 60), coachHours: round1(coachMinutes / 60) };
}

export function ageCategory(birthDate: string | null | undefined, reference = new Date()) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T12:00:00Z`);
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  if (reference.getUTCMonth() < birth.getUTCMonth() || (reference.getUTCMonth() === birth.getUTCMonth() && reference.getUTCDate() < birth.getUTCDate())) age -= 1;
  if (age < 12) return "U12";
  if (age < 14) return "U14";
  if (age < 16) return "U16";
  if (age < 18) return "U18";
  return "18+";
}

export function isoWeekKey(value: string) {
  const date = new Date(value); const day = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}
