import type { AppLocale } from "./i18n/messages.ts";
import { managerPlanningEntries } from "./i18n/managerPlanningMessages.ts";
import { managerGroupFeedback } from "./managerGroupPresentation.ts";
import { managerFormat, managerLocaleTag, type ManagerTranslate } from "./managerLocale.ts";
const feedback = new Map(Object.entries(managerPlanningEntries).flatMap(([key, values]) => values.map(value => [value, `manager.planning.${key}`] as const)));
export const managerPlanningFormat = (t: ManagerTranslate, key: string, values: Record<string, string | number>) => managerFormat(t, `manager.planning.${key}`, values);
export function managerPlanningFeedback(t: ManagerTranslate, value: string | null | undefined) {
  if (!value) return value;
  if (/^(common|manager|coach|cat)[.]/.test(value) && t(value) !== value) return t(value);
  const codes: Record<string, string> = { planning_conflict: "copyConflict", event_not_found: "eventNotFound", series_not_found: "noSeries", invalid_structure: "noStructureToCopy" };
  if (codes[value]) return t(`manager.planning.${codes[value]}`);
  if (value === "forbidden") return t("manager.settings.forbidden");
  const key = feedback.get(value);
  return key ? t(key) : managerGroupFeedback(t, value);
}
export function managerPlanningDate(startIso: string, endIso: string | null, locale: AppLocale) {
  const start = new Date(startIso), end = endIso ? new Date(endIso) : null;
  const format = (options: Intl.DateTimeFormatOptions, date = start) => Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(managerLocaleTag(locale), { timeZone: "Europe/Zurich", ...options }).format(date);
  return { day: format({ weekday: "short" }), date: format({ day: "2-digit" }), month: format({ month: "short" }), startTime: format({ hour: "2-digit", minute: "2-digit" }), endTime: end ? format({ hour: "2-digit", minute: "2-digit" }, end) : null };
}
