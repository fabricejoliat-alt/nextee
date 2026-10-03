import { coachCalendarActionState, coachEventEndMs } from "./coachCalendar.ts";

export type CoachPlanningPerson = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
export type CoachPlanningAttendee = CoachPlanningPerson & {
  is_player: boolean; status: string | null; coach_recorded_status: "present" | "absent" | null;
};
export type CoachPlanningEvent = {
  preparation_pending?: boolean;
  id: string; group_id: string; club_id: string; event_type: string; title: string | null;
  starts_at: string; ends_at: string | null; duration_minutes: number | null;
  location_text: string | null; series_id: string | null; status: string; requires_evaluation: boolean;
  evaluation_complete: boolean; coaches: CoachPlanningPerson[]; attendees: CoachPlanningAttendee[];
};
export type CoachPlanningData = {
  coachClubCount?: number;
  group: { id: string; name: string | null; club_id: string }; club_name: string | null;
  can_plan: boolean; events: CoachPlanningEvent[];
};
export type CoachPlanningTab = "all" | "upcoming" | "past" | "pending";

/** Keep the saved activity name consistent between planning and its detail card. */
export function coachPlanningTitle(title: string | null | undefined, fallback: string) {
  return title?.trim() || fallback;
}

export function coachPlanningView(events: CoachPlanningEvent[], type: string, tab: CoachPlanningTab, nowMs: number) {
  const typed = events.filter((event) => type === "all" || event.event_type === type);
  const matches = {
    all: () => true,
    upcoming: (event: CoachPlanningEvent) => event.status !== "cancelled" && coachEventEndMs(event) > nowMs,
    past: (event: CoachPlanningEvent) => coachEventEndMs(event) <= nowMs,
    pending: (event: CoachPlanningEvent) => coachCalendarActionState(event, event.evaluation_complete, nowMs) === "needs_evaluation",
  };
  return {
    counts: Object.fromEntries(Object.entries(matches).map(([key, match]) => [key, typed.filter(match).length])) as Record<CoachPlanningTab, number>,
    events: typed.filter(matches[tab]).sort((a, b) => {
      const delta = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
      return tab === "past" || tab === "pending" ? -delta : delta;
    }),
  };
}

/** An invitation/registration is not a manually recorded attendance. */
export function coachPlanningAttendanceKey(attendee: Pick<CoachPlanningAttendee, "status" | "coach_recorded_status">) {
  if (attendee.coach_recorded_status === "present") return "coach.camps.present";
  if (attendee.coach_recorded_status === "absent") return "coach.camps.absent";
  if (attendee.status === "present") return "coach.planning.registered";
  if (attendee.status === "absent") return "coach.planning.unavailable";
  if (attendee.status === "excused") return "coach.planning.excused";
  return "coach.planning.expected";
}
