export type CoachCalendarView = "year" | "month" | "week" | "day";
export const COACH_PENDING_EVALUATIONS_HREF = "/coach/calendar?view=evaluations&period=year";

export function coachCalendarInitialPeriod(filter: string | null, period: string | null): CoachCalendarView {
  if (period === "year" || period === "month" || period === "week" || period === "day") return period;
  return filter === "evaluations" ? "year" : "month";
}

export function coachCalendarInPeriod(startsAt: string, anchor: Date, view: CoachCalendarView) {
  const start = new Date(startsAt).getTime();
  if (!Number.isFinite(start)) return false;
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const to = new Date(from);
  if (view === "year") { from.setMonth(0, 1); to.setFullYear(from.getFullYear() + 1, 0, 1); }
  else if (view === "month") { from.setDate(1); to.setMonth(from.getMonth() + 1, 1); }
  else if (view === "week") { from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); to.setTime(from.getTime()); to.setDate(to.getDate() + 7); }
  else to.setDate(to.getDate() + 1);
  return start >= from.getTime() && start < to.getTime();
}
