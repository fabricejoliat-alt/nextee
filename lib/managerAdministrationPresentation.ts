import { messages, type AppLocale } from "./i18n/messages.ts";
import { defaultEvaluationChoices, EVALUATION_DOMAINS, type EvaluationResponseFormat } from "./evaluationCriteria.ts";
import { managerFormat, type ManagerTranslate } from "./managerLocale.ts";

const feedbackKeys: string[] = [
  "manager.loadError",
  "manager.saveError",
  "manager.settings.seasons.loadError",
  "manager.settings.ai.empty",
  "manager.administration.criteria.requiredInput",
  "manager.administration.criteria.updated",
  "manager.administration.criteria.created",
  "manager.administration.actionError",
  "manager.administration.criteria.deleted",
  "manager.administration.criteria.archived",
  "manager.administration.statusUpdated",
  "manager.administration.criteria.lead",
  "manager.administration.criteria.historyHelp",
  "manager.administration.criteria.empty",
  "manager.administration.criteria.optionalHelp",
  "manager.administration.players.loadError",
  "manager.administration.pageError",
  "manager.administration.seasonDataError",
  "manager.administration.players.lead",
  "manager.administration.players.empty",
  "manager.administration.coaches.loadError",
  "manager.administration.seasonStatusesError",
  "manager.administration.clubsError",
  "manager.administration.staffLead",
  "manager.administration.managers.loadError",
  "manager.administration.managers.empty",
  "manager.administration.firstNameRequired",
  "manager.administration.lastNameRequired",
  "manager.administration.functionRequired",
  "manager.administration.validEmail",
  "manager.administration.chooseClub",
  "manager.administration.coaches.createError",
  "manager.administration.coaches.createLead",
  "manager.administration.requiredHelp",
  "manager.administration.coaches.notFound",
  "manager.administration.seasonLoadError",
  "manager.administration.coaches.saved",
  "manager.administration.settingsSaved",
  "manager.administration.coaches.profileLead",
  "manager.administration.permissions.help",
  "manager.administration.permissions.groupsHelp",
  "manager.administration.permissions.planningHelp",
  "manager.administration.permissions.transferHelp",
  "manager.administration.permissions.aiHelp",
  "manager.administration.managers.createError",
  "manager.administration.managers.createLead",
  "manager.administration.missingClub",
  "manager.administration.managers.profileError",
  "manager.administration.managers.notFound",
  "manager.administration.usernameRequired",
  "manager.administration.managers.saveError",
  "manager.administration.managers.saved",
  "manager.administration.managers.profileLead",
  "manager.administration.criteria.usedError",
  "manager.administration.criteria.nameRequired",
  "manager.administration.criteria.invalidRespondent",
  "manager.administration.criteria.invalidFormat",
  "manager.administration.criteria.validActivity",
  "manager.administration.criteria.domainRequired",
  "manager.administration.criteria.domainLabelRequired"
];
const knownFeedback = new Map(feedbackKeys.flatMap(key => (["fr", "en", "de", "it"] as AppLocale[]).map(locale => [messages[locale][key], key] as const)));
for (const value of ["Missing token", "Invalid token", "Unauthorized"]) knownFeedback.set(value, "manager.settings.invalidSession");
knownFeedback.set("Forbidden", "manager.settings.forbidden");

/** Localize known feedback, including combined criterion validation; keep unknown diagnostics intact. */
export function managerAdministrationFeedback(t: ManagerTranslate, value: string | undefined): string | undefined {
  if (!value) return value;
  const key = knownFeedback.get(value);
  if (key) return t(key);
  const parts = value.match(/[^.]+\.(?:\s*|$)/g);
  if (parts && parts.map(part => part.trim()).join(" ") === value.trim() && parts.every(part => knownFeedback.has(part.trim()))) {
    return parts.map(part => t(knownFeedback.get(part.trim())!)).join(" ");
  }
  return value;
}

export const managerAdministrationFormat = (t: ManagerTranslate, key: string, values: Record<string, string | number>) => managerFormat(t, `manager.administration.${key}`, values);

/** Only known standard domain labels are translated. A club's own label is content. */
export function managerCriterionDomain(t: ManagerTranslate, key: string, label: string) {
  const standard = EVALUATION_DOMAINS.find(domain => domain.value === key);
  return standard && label === standard.label ? t(`manager.administration.domain.${key}`) : label;
}

/** Seed new choices in the selected language; their stored values and icons never change. */
export function managerNewCriterionChoices(t: ManagerTranslate, format: EvaluationResponseFormat) {
  const labels: Record<string, string[]> = {
    delta: ["choice.reinforce", "choice.progress", "choice.achieved"],
    sentiment: ["choice.negative", "choice.neutral", "choice.positive"],
    feeling: ["choice.veryBad", "choice.bad", "choice.neutral", "choice.good", "choice.veryGood"],
    yes_no: ["no", "yes"],
  };
  return defaultEvaluationChoices(format).map((choice, index) => ({ ...choice, label: format === "yes_no" ? t(`manager.profile.${labels[format][index]}`) : labels[format] ? t(`manager.administration.${labels[format][index]}`) : choice.label }));
}
