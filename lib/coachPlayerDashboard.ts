export type DashboardSession = {
  id: string; start_at: string; total_minutes: number | null;
  motivation: number | null; difficulty: number | null; satisfaction: number | null;
  session_type: "club" | "private" | "individual"; club_event_id: string | null;
  club_id: string | null; coach_user_id: string | null;
};
export type DashboardItem = { session_id: string; category: string; minutes: number };
export type DashboardEvent = {
  id: string; club_id: string; starts_at: string; ends_at: string | null;
  duration_minutes: number | null; status: string; event_type: string | null;
};
export type DashboardAttendance = { event_id: string; status: string | null; coach_recorded_status: string | null };
export type DashboardPeriod = { from: string; to: string };

export function inDashboardPeriod(timestamp: string, period: DashboardPeriod) {
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && (!period.from || time >= new Date(`${period.from}T00:00:00Z`).getTime())
    && (!period.to || time < new Date(`${period.to}T00:00:00Z`).getTime() + 86_400_000);
}

/** Only the coach's recorded attendance establishes whether a training was attended. */
export function dashboardAttendance(events: DashboardEvent[], attendance: DashboardAttendance[], period: DashboardPeriod, now = Date.now()) {
  const byEvent = new Map(attendance.map(row => [row.event_id, row.coach_recorded_status]));
  let present = 0;
  let total = 0;
  for (const event of events) {
    const end = event.ends_at ? Date.parse(event.ends_at) : Date.parse(event.starts_at) + Math.max(1, event.duration_minutes ?? 0) * 60_000;
    const status = byEvent.get(event.id);
    if (event.status === "cancelled" || event.event_type !== "training" || end > now || !inDashboardPeriod(event.starts_at, period)) continue;
    if (status !== "present" && status !== "absent") continue;
    total++;
    if (status === "present") present++;
  }
  return { present, total, rate: total ? Math.round(present / total * 100) : null };
}

/** One normalized dataset drives both totals and charts, including sessions without detailed items. */
export function dashboardTrainingPeriod(args: {
  sessions: DashboardSession[]; items: DashboardItem[]; events: DashboardEvent[];
  attendance: DashboardAttendance[]; period: DashboardPeriod; performance: boolean; now?: number;
}) {
  const now = args.now ?? Date.now();
  const recorded = new Map(args.attendance.map(row => [row.event_id, row.coach_recorded_status ?? row.status]));
  const sessions = args.sessions.filter(row => inDashboardPeriod(row.start_at, args.period)
    && (args.performance || (!row.club_event_id && row.session_type !== "club")));
  if (!args.performance) {
    for (const event of args.events) {
      const end = event.ends_at ? Date.parse(event.ends_at) : Date.parse(event.starts_at) + Math.max(1, event.duration_minutes ?? 0) * 60_000;
      if (event.status === "cancelled" || end > now || recorded.get(event.id) !== "present" || !inDashboardPeriod(event.starts_at, args.period)) continue;
      const minutes = event.duration_minutes && event.duration_minutes > 0 ? event.duration_minutes
        : Math.max(0, Math.round((end - Date.parse(event.starts_at)) / 60_000));
      sessions.push({ id: `event:${event.id}`, start_at: event.starts_at, total_minutes: minutes, session_type: "club",
        club_event_id: event.id, club_id: event.club_id, coach_user_id: null, motivation: null, difficulty: null, satisfaction: null });
    }
  }
  sessions.sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id));
  const ids = new Set(sessions.map(row => row.id));
  const items = args.items.filter(row => ids.has(row.session_id));
  const minutesBySession = new Map<string, number>();
  for (const item of items) minutesBySession.set(item.session_id, (minutesBySession.get(item.session_id) ?? 0) + Math.max(0, Number(item.minutes) || 0));
  const minutes = sessions.reduce((total, row) => total + (minutesBySession.get(row.id) ?? Math.max(0, row.total_minutes ?? 0)), 0);
  return { sessions, items, minutes, count: sessions.length, attendance: dashboardAttendance(args.events, args.attendance, args.period, now) };
}
