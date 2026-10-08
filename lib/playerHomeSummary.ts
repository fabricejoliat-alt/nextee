export type HomeHistorySession = {
  id: string; start_at: string; total_minutes: number | null;
  motivation: number | null; difficulty: number | null; satisfaction: number | null;
  session_type: "club" | "private" | "individual"; club_event_id: string | null;
};
export type HomeHistoryItem = { session_id: string; category: string; minutes: number };
export type HomeHistoryEvent = {
  id: string; event_type: string; title: string | null; starts_at: string;
  ends_at: string | null; duration_minutes: number | null; status: string; requires_evaluation: boolean;
};
export type HomeHistoryAttendance = { event_id: string; status: string | null };

export function summarizePlayerHome(input: {
  sessions: HomeHistorySession[]; items: HomeHistoryItem[]; events: HomeHistoryEvent[];
  attendees: HomeHistoryAttendance[]; performanceEnabled: boolean;
  monthStart: string; monthEnd: string; previousMonthStart: string; now: string;
}) {
  const now = Date.parse(input.now);
  const currentStart = Date.parse(input.monthStart);
  const previousStart = Date.parse(input.previousMonthStart);
  const monthEnd = Date.parse(input.monthEnd);
  const eventsById = new Map(input.events.map(event => [event.id, event]));
  const statusById = new Map(input.attendees.map(row => [row.event_id, row.status]));
  const sessionsByEvent = new Map(input.sessions.filter(session => session.club_event_id).map(session => [session.club_event_id, session]));
  const hasMinutes = new Set(input.items.filter(item => Number(item.minutes) > 0).map(item => item.session_id));
  const complete = new Set(input.sessions.filter(session => hasMinutes.has(session.id)
    && typeof session.motivation === "number" && typeof session.difficulty === "number"
    && typeof session.satisfaction === "number").map(session => session.id));
  const pendingTrainings: Array<{ id: string; dateIso: string; title: string; href: string }> = [];
  if (input.performanceEnabled) {
    for (const event of input.events) {
      if (!statusById.has(event.id) || event.status !== "scheduled" || !event.requires_evaluation
        || !["training", "camp"].includes(event.event_type) || Date.parse(event.ends_at ?? event.starts_at) >= now
        || ["absent", "excused", "not_registered"].includes(statusById.get(event.id) ?? "")) continue;
      const session = sessionsByEvent.get(event.id);
      if (session && complete.has(session.id)) continue;
      pendingTrainings.push({ id: event.id, dateIso: event.starts_at,
        title: event.title?.trim() || (event.event_type === "camp" ? "Stage" : "Entraînement"),
        href: session ? `/player/golf/trainings/${session.id}/edit` : `/player/golf/trainings/new?club_event_id=${encodeURIComponent(event.id)}` });
    }
    for (const session of input.sessions) {
      if (session.club_event_id || complete.has(session.id) || Date.parse(session.start_at) >= now) continue;
      pendingTrainings.push({ id: session.id, dateIso: session.start_at, title: "Entraînement individuel", href: `/player/golf/trainings/${session.id}/edit` });
    }
  }
  pendingTrainings.sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso));
  const attendanceFor = (from: number, to: number) => {
    let present = 0, expected = 0;
    for (const event of input.events) {
      const date = Date.parse(event.starts_at), status = statusById.get(event.id);
      if (date < from || date >= to || date >= now || event.status !== "scheduled"
        || !["training", "interclub", "camp", "event", "session"].includes(event.event_type)
        || !["present", "absent"].includes(status ?? "")) continue;
      expected += 1;
      if (status === "present") present += 1;
    }
    return { present, expected, rate: expected ? Math.round(present / expected * 100) : 0 };
  };
  const current = attendanceFor(currentStart, now), previous = attendanceFor(previousStart, currentStart);
  const duration = (event: HomeHistoryEvent) => {
    const minutes = Number(event.duration_minutes ?? 0);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
    const diff = event.ends_at ? Math.round((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 60_000) : 0;
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  };
  const monthSessions = input.sessions.filter(session => {
    const date = Date.parse(session.start_at); return date >= currentStart && date < monthEnd;
  }).sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at));
  const monthIds = new Set(monthSessions.map(session => session.id));
  const monthClubEventDurationById: Record<string, number> = {};
  for (const session of monthSessions) {
    if (!session.club_event_id) continue;
    const event = eventsById.get(session.club_event_id);
    if (event) monthClubEventDurationById[event.id] = duration(event);
  }
  const monthPlannedClubEvents = input.events.filter(event => {
    const date = Date.parse(event.starts_at);
    return statusById.get(event.id) === "present" && event.status !== "cancelled"
      && date >= currentStart && date < monthEnd && date < now;
  });
  return {
    pendingTrainings,
    attendanceInsight: current.expected ? { ...current, change: previous.expected ? current.rate - previous.rate : null } : null,
    monthSessions, monthItems: input.items.filter(item => monthIds.has(item.session_id)),
    monthClubEventDurationById, monthPlannedClubEvents,
    monthPlannedClubMinutes: monthPlannedClubEvents.reduce((sum, event) => sum + duration(event), 0),
  };
}

export type PlayerHomeSummary = ReturnType<typeof summarizePlayerHome>;
