import type { AppLocale } from "./i18n/messages.ts";
import { managerCount, managerFormat, managerLocaleTag, type ManagerTranslate } from "./managerLocale.ts";

export type ManagerProgressSignal = { kind: "handicap" | "attendance" | "regularity" | "volume"; value: number };
export type ManagerAttentionValue = { type: string; value: string; amount?: number; since?: string | null; signals?: ManagerProgressSignal[]; hours?: number; medianHours?: number };

export function managerPerformanceFormatters(t: ManagerTranslate, locale: AppLocale) {
  const localeTag = managerLocaleTag(locale);
  const number = (value: number) => value.toLocaleString(localeTag);
  const metric = (value: number | null | undefined, suffix = "") => value == null || !Number.isFinite(value)
    ? t("manager.performance.insufficient") : `${number(value)}${suffix}`;
  const format = (key: string, values: Record<string, string | number>) => managerFormat(t, `manager.performance.${key}`, values);
  const count = (key: string, value: number) => managerCount(t, locale, `manager.performance.${key}`, value);
  const date = (input: string | null | undefined) => input && Number.isFinite(Date.parse(input))
    ? new Intl.DateTimeFormat(localeTag, { dateStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(input))
    : t("manager.performance.noActivity");
  const month = (input: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(input)
    ? new Intl.DateTimeFormat(localeTag, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${input}-01T00:00:00Z`)) : input;
  const duration = (value: number | null) => {
    if (value == null || !Number.isFinite(value)) return t("manager.performance.insufficient");
    const minutes = Math.round(value);
    return `${number(Math.floor(minutes / 60))} h ${String(minutes % 60).padStart(2, "0")}`;
  };
  const signals = (items: ManagerProgressSignal[]) => items.map((item) => format(`signal.${item.kind}`, { value: number(item.value) })).join(" · ");
  const juniorAttention = (item: ManagerAttentionValue) => {
    if (item.type === "inactive") return item.since ? format("since", { date: date(item.since) }) : t("manager.performance.noAttendance");
    if (item.type === "progress") return signals(item.signals ?? []);
    if (item.type === "attendance-down") return format("points", { value: metric(item.amount) });
    return metric(item.amount, item.type === "objective" ? " %" : "");
  };
  const coachAttention = (item: ManagerAttentionValue) => {
    if (item.type === "future-no-coach") return date(item.value);
    if (item.type === "group-no-head") return t("manager.performance.headNeeded");
    if (item.type === "load") return format("loadComparison", { hours: metric(item.hours), median: metric(item.medianHours) });
    return metric(item.amount);
  };
  return { metric, duration, date, month, format, count, signals, juniorAttention, coachAttention };
}
