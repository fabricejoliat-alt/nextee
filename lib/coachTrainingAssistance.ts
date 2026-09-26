import { CoachDebriefValidationError } from "./coachDebrief.ts";

export function assertCoachTrainingReportAllowed(enabled: boolean, reportText: string | null) {
  if (!enabled && String(reportText ?? "").trim()) {
    throw new CoachDebriefValidationError(
      "coach_training_assistance_disabled",
      "Training assistance is disabled for this organization."
    );
  }
}
