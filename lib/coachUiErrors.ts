const messages: Record<string, string> = {
  event_not_found: "coach.error.notFound",
  group_not_found: "coach.error.groupAccess",
  forbidden: "coach.error.forbidden",
  evaluation_conflict: "coach.error.conflict",
  required_criteria_missing: "coach.error.criteria",
  evaluation_disabled: "coach.error.disabled",
  unknown_attendee: "coach.error.attendee",
  player_not_attendee: "coach.error.attendee",
  event_not_finished: "coach.error.notFinished",
  event_cancelled: "coach.error.cancelled",
  assistance_disabled: "coach.error.aiDisabled",
  ai_review_required: "coach.error.aiReview",
  ai_authorization_required: "coach.error.aiAuthorization",
  invalid_custom_responses: "coach.error.invalid",
  invalid_custom_criterion: "coach.error.invalid",
  invalid_custom_response: "coach.error.invalid",
  attendance_required: "coach.error.invalid",
  ratings_required: "coach.error.invalid",
  individual_comment_too_long: "coach.error.invalid",
  invalid_note: "coach.error.invalid",
};

/** Return a key, not server/database text, so a language change updates existing errors. */
export function coachUiErrorKey(status: number, payload: unknown, fallback: string): string {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const code = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : "";
  if (Object.hasOwn(messages, code)) return messages[code];
  if (status === 401) return "coach.error.session";
  if (status === 403) return "coach.error.forbidden";
  if (status === 404) return "coach.error.notFound";
  if (status === 409) return "coach.error.conflict";
  if (status === 429) return "coach.error.rateLimit";
  return fallback;
}

export function coachCaughtErrorKey(cause: unknown, fallback: string): string {
  return cause instanceof Error && /^coach\.error\.[A-Za-z]+$/.test(cause.message) ? cause.message : fallback;
}
