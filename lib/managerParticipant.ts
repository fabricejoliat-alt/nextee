import { supabase } from "@/lib/supabaseClient";
import type { EventEvaluationCriterion } from "./evaluationCriteria.ts";
import type { AppLocale } from "./i18n/messages.ts";
import { managerLocaleTag } from "./managerLocale.ts";

export type ParticipantFeedback = { event_id: string; player_id: string; coach_id: string; engagement: number | null; attitude: number | null; performance: number | null; visible_to_player: boolean; private_note: string | null; player_note: string | null };
export type ManagerEvaluationSnapshot = {
  event: { id: string; group_id: string; club_id: string; event_type: "training" | "interclub" | "camp" | "session" | "event"; status: "scheduled" | "cancelled"; starts_at: string; ends_at: string | null; duration_minutes: number; requires_evaluation: boolean };
  attendee: { player_id: string; status: string; coach_recorded_status: "present" | "absent" | null; coach_recorded_at: string | null };
  feedback: ParticipantFeedback[]; criteria: EventEvaluationCriterion[];
  responses: Array<{ event_criterion_id: string; value_json: string | number | boolean | null }>;
};
export const participantDate = (iso: string, locale: AppLocale) => new Intl.DateTimeFormat(managerLocaleTag(locale), {
  weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich",
}).format(new Date(iso));

/** The shared staff endpoint enforces active club/event access and actual attendance membership. */
export async function loadManagerParticipant<T>(eventId: string, playerId: string, groupId: string): Promise<T> {
  if (!eventId || !playerId || !groupId) throw new Error("coach.error.attendee");
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("coach.error.session");
  const response = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/players/${encodeURIComponent(playerId)}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 403 ? "coach.error.forbidden" : response.status === 404 ? "coach.error.attendee" : "coach.error.load");
  if (body.event?.id !== eventId || body.event?.group_id !== groupId || body.player?.id !== playerId) throw new Error("coach.error.attendee");
  return body as T;
}
export function participantError(cause: unknown, fallback = "coach.error.save") {
  const error = (cause && typeof cause === "object" ? cause : {}) as { message?: string; code?: string };
  const codes: Record<string,string> = {
    forbidden: "coach.error.forbidden", unknown_attendee: "coach.error.attendee", event_not_found: "coach.error.notFound",
    event_cancelled: "coach.error.cancelled", event_not_finished: "coach.error.notFinished", evaluation_disabled: "coach.error.disabled",
    evaluation_conflict: "manager.participant.conflict", attendance_required: "manager.participant.attendanceRequired", ratings_required: "manager.participant.ratingsRequired",
    invalid_custom_response: "coach.error.criteria", invalid_custom_criterion: "coach.error.criteria", required_criteria_missing: "coach.error.criteria", invalid_note: "manager.participant.noteTooLong",
  };
  if (/^(coach|manager|common)\./.test(error.message ?? "")) return error.message!;
  if (error.code === "PGRST202" || error.code === "42883") return "manager.participant.serviceUnavailable";
  return codes[error.message ?? ""] ?? fallback;
}
