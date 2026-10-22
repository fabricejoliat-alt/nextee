/** A saved answer locks attendance even if the coach has not evaluated the player yet. */
export function hasPlayerEvaluation(ratings: Array<number | null>) {
  return ratings.some((value) => value != null);
}

export function hasPlayerEvaluationAnswer(value: unknown) {
  return value != null && value !== "";
}

/** An invitation with no recorded absence may still be confirmed as present. */
export function evaluatedAttendanceStatus(status: string | null, recordedStatus: string | null): "present" | "absent" {
  const effective = recordedStatus ?? status;
  return effective === "absent" || effective === "excused" ? "absent" : "present";
}
