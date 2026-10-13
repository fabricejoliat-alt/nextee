type CalendarEvent = {
  id: string; event_type: string | null; starts_at: string; ends_at: string | null;
  duration_minutes?: number | null; status: string;
};
type TrainingSession = { start_at: string; total_minutes: number | null; session_type: string; club_event_id: string | null };
type PersonalActivity = { event_type: string; starts_at: string; ends_at: string; status: string };
type Attendance = { present: number; total: number; rate: number | null };

function activityEnd(start: string, end: string | null, minutes?: number | null) {
  return end ? new Date(end).getTime() : new Date(start).getTime() + Math.max(1, Number(minutes ?? 0)) * 60_000;
}

export function playerGolfOverviewStats(args: {
  events: CalendarEvent[]; attendance: Record<string, string | null>;
  sessions: TrainingSession[]; personalActivities: PersonalActivity[]; now: Date;
}) {
  const now = args.now.getTime();
  const monthStart = new Date(args.now.getFullYear(), args.now.getMonth(), 1).getTime();
  const previousMonthStart = new Date(args.now.getFullYear(), args.now.getMonth() - 1, 1).getTime();
  const seasonStart = new Date(args.now.getFullYear(), 0, 1).getTime();
  const attendanceTypes = new Set(["training", "interclub", "camp", "event", "session"]);
  const attendance = (from: number, to: number): Attendance => {
    const eligible = args.events.filter(event => {
      const start = new Date(event.starts_at).getTime();
      const status = args.attendance[event.id];
      return event.status === "scheduled" && attendanceTypes.has(event.event_type ?? "")
        && start >= from && start < to && (status === "present" || status === "absent");
    });
    const present = eligible.filter(event => args.attendance[event.id] === "present").length;
    return { present, total: eligible.length, rate: eligible.length ? Math.round(present / eligible.length * 100) : null };
  };
  const month = attendance(monthStart, now);
  const previousMonth = attendance(previousMonthStart, monthStart);
  const season = attendance(seasonStart, now);
  const upcomingByType = new Map<string, number>();
  const count = (type: string) => upcomingByType.set(type, (upcomingByType.get(type) ?? 0) + 1);
  args.events.forEach(event => {
    if (event.status === "scheduled" && activityEnd(event.starts_at, event.ends_at, event.duration_minutes) >= now)
      count(event.event_type ?? "event");
  });
  args.sessions.forEach(session => {
    if (!session.club_event_id && activityEnd(session.start_at, null, session.total_minutes) >= now)
      count(session.session_type);
  });
  args.personalActivities.forEach(activity => {
    if (activity.status === "scheduled" && activityEnd(activity.starts_at, activity.ends_at) >= now)
      count(activity.event_type);
  });

  return {
    month: { ...month, trend: month.rate != null && previousMonth.rate != null ? month.rate - previousMonth.rate : null },
    season,
    upcoming: [...upcomingByType.values()].reduce((sum, value) => sum + value, 0),
    upcomingByType: [...upcomingByType].sort((a, b) => b[1] - a[1]),
  };
}
