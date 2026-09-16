export const EVALUATION_ACTIVITY_TYPES = ["training", "interclub", "camp", "session", "event", "competition"] as const;
export type EvaluationActivityType = (typeof EVALUATION_ACTIVITY_TYPES)[number];

export const EVALUATION_RESPONDENTS = ["coach", "player", "both"] as const;
export type EvaluationRespondent = (typeof EVALUATION_RESPONDENTS)[number];

export const EVALUATION_RESPONSE_FORMATS = ["scale_1_6", "delta", "sentiment", "feeling", "yes_no", "short_text"] as const;
export type EvaluationResponseFormat = (typeof EVALUATION_RESPONSE_FORMATS)[number];

export const EVALUATION_DOMAINS = [
  { value: "technique", label: "Technique" },
  { value: "short_game", label: "Petit jeu" },
  { value: "putting", label: "Putting" },
  { value: "strategy", label: "Stratégie et tactique" },
  { value: "mental", label: "Mental" },
  { value: "physical", label: "Physique" },
  { value: "behaviour", label: "Comportement" },
  { value: "autonomy", label: "Autonomie" },
  { value: "safety", label: "Sécurité" },
  { value: "other", label: "Autre" },
] as const;

export type EvaluationChoice = { value: string | number | boolean; label: string; icon?: string };

export type EvaluationCriterion = {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  respondent: EvaluationRespondent;
  response_format: EvaluationResponseFormat;
  choices_json: EvaluationChoice[];
  activity_types: EvaluationActivityType[];
  domain_key: string;
  domain_label: string;
  is_required: boolean;
  is_active: boolean;
  archived_at: string | null;
  sort_order: number;
  used_count?: number;
};

export type EventEvaluationCriterion = {
  id: string;
  event_id: string;
  criterion_id: string | null;
  snapshot_name: string;
  snapshot_description: string | null;
  snapshot_respondent: EvaluationRespondent;
  snapshot_response_format: EvaluationResponseFormat;
  snapshot_choices: EvaluationChoice[];
  snapshot_domain_key: string;
  snapshot_domain_label: string;
  snapshot_is_required: boolean;
  position: number;
  is_enabled: boolean;
};

const DEFAULT_CHOICES: Record<EvaluationResponseFormat, EvaluationChoice[]> = {
  scale_1_6: [1, 2, 3, 4, 5, 6].map((value) => ({ value, label: String(value) })),
  delta: [
    { value: -1, label: "À renforcer" },
    { value: 0, label: "En cours" },
    { value: 1, label: "Acquis" },
  ],
  sentiment: [
    { value: "negative", label: "Négatif" },
    { value: "neutral", label: "Neutre" },
    { value: "positive", label: "Positif" },
  ],
  feeling: [
    { value: "very_bad", label: "Très difficile", icon: "😞" },
    { value: "bad", label: "Difficile", icon: "🙁" },
    { value: "neutral", label: "Neutre", icon: "😐" },
    { value: "good", label: "Bien", icon: "🙂" },
    { value: "very_good", label: "Très bien", icon: "😄" },
  ],
  yes_no: [
    { value: false, label: "Non" },
    { value: true, label: "Oui" },
  ],
  short_text: [],
};

export function defaultEvaluationChoices(format: EvaluationResponseFormat) {
  return DEFAULT_CHOICES[format].map((choice) => ({ ...choice }));
}

export function respondentIncludes(respondent: EvaluationRespondent, role: "coach" | "player") {
  return respondent === role || respondent === "both";
}

export function criterionAppliesTo(criterion: Pick<EvaluationCriterion, "club_id" | "activity_types" | "is_active" | "archived_at">, clubId: string, activityType: string) {
  return criterion.club_id === clubId && criterion.is_active && !criterion.archived_at && criterion.activity_types.includes(activityType as EvaluationActivityType);
}

export function validateCriterionInput(input: Partial<EvaluationCriterion>) {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Le nom est requis.");
  if (!EVALUATION_RESPONDENTS.includes(input.respondent as EvaluationRespondent)) errors.push("L’évaluateur est invalide.");
  if (!EVALUATION_RESPONSE_FORMATS.includes(input.response_format as EvaluationResponseFormat)) errors.push("Le format est invalide.");
  const activityTypes = Array.isArray(input.activity_types) ? input.activity_types : [];
  if (activityTypes.length === 0 || activityTypes.some((type) => !EVALUATION_ACTIVITY_TYPES.includes(type as EvaluationActivityType))) {
    errors.push("Sélectionnez au moins un type d’activité valide.");
  }
  if (!String(input.domain_key ?? "").trim()) errors.push("Le domaine est requis.");
  if (!String(input.domain_label ?? "").trim()) errors.push("Le libellé du domaine est requis.");
  return errors;
}

export function validateResponseValue(format: EvaluationResponseFormat, choices: EvaluationChoice[], value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (format === "short_text") return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 240;
  return choices.some((choice) => String(choice.value) === String(value));
}

export function validateEventCriterionSelection(ids: string[]) {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
  return { ids: unique, valid: unique.length <= 3, error: unique.length <= 3 ? null : "Trois critères personnalisés maximum par activité." };
}
