export type CoachEventEditSnapshot = {
  event: Record<string, unknown>;
  coach_ids: string[];
  player_ids: string[];
  structure: Array<{ category: string; minutes: number; note: string | null; position: number }>;
  camp_day: Record<string, unknown> | null;
};

/** Preserve the loaded values exactly for the transaction's stale-form check. */
export function coachEventEditSnapshot(detail: {
  event: Record<string, unknown>; selectedCoachIds?: string[];
  attendees?: Array<{ player_id: string }>; structureItems?: CoachEventEditSnapshot["structure"];
  campDay?: Record<string, unknown> | null;
}): CoachEventEditSnapshot {
  return { event: { ...detail.event }, coach_ids: [...(detail.selectedCoachIds ?? [])],
    player_ids: (detail.attendees ?? []).map((row) => row.player_id),
    structure: (detail.structureItems ?? []).map((row) => ({ ...row })), camp_day: detail.campDay ?? null };
}

/** Never render database details, and never retry a partial legacy write. */
export function coachEventSaveErrorKey(cause: unknown): string {
  const error = cause && typeof cause === "object" ? cause as { message?: string; code?: string } : {};
  const known: Record<string, string> = {
    forbidden: "coach.error.forbidden", event_not_found: "coach.error.notFound", event_cancelled: "coach.error.cancelled",
    planning_conflict: "coach.error.planningConflict", evaluated_attendee_removal: "coach.error.planningRecorded",
    title_required: "coach.error.planningTitle", invalid_event: "coach.error.planningDates",
    invalid_structure: "coach.error.planningStructure", invalid_assignments: "coach.error.planningAssignments",
    use_camp_editor: "coach.error.planningCamp", use_competition_editor: "coach.error.forbidden",
    invalid_recurrence: "coach.error.planningRecurrence", no_occurrence: "coach.error.planningNoOccurrence",
    no_future_occurrence: "coach.error.planningNoOccurrence", too_many_occurrences: "coach.error.planningTooMany",
    creation_request_conflict: "coach.error.creationUncertain",
  };
  if (error.message && Object.hasOwn(known, error.message)) return known[error.message];
  if (error.code === "PGRST202" || error.code === "42883") return "coach.error.planningMigration";
  return "coach.error.planningSave";
}

/** Only a definite rejection permits editing and starting a new creation request. */
export function coachCreationErrorIsDefinite(cause: unknown): boolean {
  const key = coachEventSaveErrorKey(cause);
  return key !== "coach.error.planningSave" && key !== "coach.error.creationUncertain";
}
