import { managerJuniorEntries } from "./i18n/managerJuniorMessages.ts";
import { managerAdministrationFeedback } from "./managerAdministrationPresentation.ts";
import { managerFormat, managerLocaleTag, type ManagerTranslate } from "./managerLocale.ts";
import type { AppLocale } from "./i18n/messages.ts";

const feedbackKeys = new Map(Object.entries(managerJuniorEntries).flatMap(([key, values]) => values.map(value => [value, `manager.junior.${key}`] as const)));

export function managerJuniorFeedback(t: ManagerTranslate, value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.startsWith("manager.junior.") && managerJuniorEntries[value.slice("manager.junior.".length)]) return t(value);
  const key = feedbackKeys.get(value);
  return key ? t(key) : managerAdministrationFeedback(t, value);
}

export const managerJuniorFormat = (t: ManagerTranslate, key: string, values: Record<string, string | number>) => managerFormat(t, `manager.junior.${key}`, values);

export function managerJuniorDate(t: ManagerTranslate, locale: AppLocale, value: string | null | undefined, withTime = true) {
  if (!value) return t("manager.junior.report.never");
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(managerLocaleTag(locale), { dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}), timeZone: "Europe/Zurich" }).format(date);
}

export function managerReportStatus(t: ManagerTranslate, status: string | null) {
  return status && !["sent", "failed", "skipped", "pending"].includes(status) ? status : t(`manager.junior.report.status.${status ?? "none"}`);
}
