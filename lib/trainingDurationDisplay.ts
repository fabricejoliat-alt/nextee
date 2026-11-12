export type TrainingDurationUnit = "minutes" | "hours";
export const TRAINING_DURATION_METADATA_KEY = "training_statistics_duration_unit";

export function trainingDurationUnit(metadata: Record<string, unknown> | null | undefined): TrainingDurationUnit {
  return metadata?.[TRAINING_DURATION_METADATA_KEY] === "hours" ? "hours" : "minutes";
}

/** Display only: stored durations, input controls and calculations stay in minutes. */
export function formatTrainingDuration(value: number | null | undefined, unit: TrainingDurationUnit, minutesLabel = "min"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const minutes = Math.max(0, Math.round(value));
  return unit === "hours"
    ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`
    : `${minutes} ${minutesLabel}`;
}
