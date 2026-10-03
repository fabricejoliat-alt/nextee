import type { AppLocale } from "./i18n/messages.ts";
import { managerCount, managerLocaleTag, type ManagerTranslate } from "./managerLocale.ts";
import { managerJuniorFormat } from "./managerJuniorPresentation.ts";
import { managerPerformanceFormatters } from "./managerPerformancePresentation.ts";
import { playerSummarySignals } from "./playerStatistics.ts";

type SummaryOverview = { attendance: { rate: number | null; denominator: number }; training: { objectiveRate: number | null }; regularity: { rate: number | null }; handicap: { change: number | null } };
export function managerJuniorStatisticsLabels(t: ManagerTranslate, locale: AppLocale) {
  const value = (input: number | null | undefined, suffix = "") => input == null || !Number.isFinite(input) ? "—" : `${input.toLocaleString(managerLocaleTag(locale))}${suffix}`;
  const format = (key: string, values: Record<string, string | number>) => managerJuniorFormat(t, `stats.${key}`, values);
  const minutes = (input: number | null | undefined) => {
    if (input == null || !Number.isFinite(input)) return t("manager.performance.insufficient");
    const rounded = Math.round(input);
    return rounded >= 60 ? `${value(Math.floor(rounded / 60))} h ${String(rounded % 60).padStart(2, "0")}` : `${value(rounded)} min`;
  };
  const trend = (input: number | null | undefined, unit = " %") => input == null || !Number.isFinite(input) ? t("manager.junior.stats.noComparison") : format("trend", { value: `${input > 0 ? "+" : ""}${value(input)}`, unit });
  const summary = (o: SummaryOverview) => playerSummarySignals({ attendanceRate: o.attendance.rate, samples: o.attendance.denominator, objectiveRate: o.training.objectiveRate, regularityRate: o.regularity.rate, handicapChange: o.handicap.change }).map(signal => {
    if (signal.kind === "improvement" || signal.kind === "change") return managerCount(t, locale, `manager.junior.stats.summary${signal.kind === "improvement" ? "Improvement" : "Change"}`, signal.value);
    const key = { attendance: "summaryAttendance", objective: "summaryObjective", regularity: "summaryRegularity" }[signal.kind];
    return format(key, { value: value(signal.value) });
  }).join(" ") || t("manager.junior.stats.summaryEmpty");
  const eventType = (label: string) => {
    const keys: Record<string, string> = { "Entraînements": "manager.junior.report.training", "Interclubs": "manager.junior.stats.event.interclub", "Stages et camps": "manager.junior.stats.event.camp", "Compétitions du club": "manager.junior.stats.event.competition", "Autres activités": "manager.junior.stats.event.other" };
    return keys[label] ? t(keys[label]) : label;
  };
  const category = (key: string) => ["warmup_mobility", "long_game", "short_game_all", "putting", "wedging", "pitching", "chipping", "bunker", "course", "mental", "fitness", "other"].includes(key) ? t(`cat.${key}`) : key;
  const responseFormat = (format?: string) => {
    const keys: Record<string, string> = { scale_1_6: "manager.administration.criteria.scale", delta: "manager.administration.criteria.delta", sentiment: "manager.administration.criteria.sentiment", feeling: "manager.administration.criteria.feeling", yes_no: "manager.fields.boolean", short_text: "manager.fields.short_text" };
    return format && keys[format] ? t(keys[format]) : format || "—";
  };
  const customResponse = (input: unknown, choices?: Array<{ value: string | number | boolean; label: string }>) => {
    const choice = choices?.find(choice => String(choice.value) === String(input));
    if (choice) return choice.label;
    if (typeof input === "boolean") return t(input ? "manager.content.yes" : "manager.content.no");
    return typeof input === "number" ? value(input) : input == null ? "—" : typeof input === "object" ? JSON.stringify(input) : String(input);
  };
  return { value, minutes, trend, summary, eventType, category, responseFormat, customResponse, month: managerPerformanceFormatters(t, locale).month };
}
