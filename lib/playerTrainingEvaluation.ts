export function playerTrainingEvaluationState(input: {
  performanceEnabled: boolean;
  isPast: boolean;
  completed: boolean;
  eventType?: string | null;
  requiresEvaluation?: boolean;
  attendance?: string | null;
}) {
  const eligible = input.performanceEnabled && input.isPast
    && (!input.eventType || ["training", "camp"].includes(input.eventType))
    && !["absent", "excused", "not_registered"].includes(input.attendance ?? "");
  const required = input.requiresEvaluation !== false;
  return {
    needsEvaluation: eligible && required && !input.completed,
    optionalEvaluation: eligible && !required && !input.completed,
    completed: input.isPast && (!eligible || !required || input.completed),
  };
}
