import { managerGroupEntries } from "./i18n/managerGroupMessages.ts";
import { managerAdministrationFeedback } from "./managerAdministrationPresentation.ts";
import { managerFormat, type ManagerTranslate } from "./managerLocale.ts";

const feedbackKeys = new Map(Object.entries(managerGroupEntries).flatMap(([key, values]) => values.map(value => [value, `manager.groups.${key}`] as const)));
/** Translate known interface feedback; keep names and unknown diagnostics unchanged. */
export function managerGroupFeedback(t: ManagerTranslate, value: string | null | undefined) {
  if (!value) return value;
  if (value.startsWith("manager.") || value.startsWith("coachGroup")) return t(value);
  const key = feedbackKeys.get(value);
  return key ? t(key) : managerAdministrationFeedback(t, value);
}
export const managerGroupFormat = (t: ManagerTranslate, key: string, values: Record<string, string | number>) => managerFormat(t, `manager.groups.${key}`, values);
