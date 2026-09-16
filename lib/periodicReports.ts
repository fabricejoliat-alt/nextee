import type { DateRange } from "@/lib/playerStatistics";

export type ReportFrequency = "monthly" | "quarterly" | "semiannual";

const EVENT_TYPE_LABELS: Record<string, Record<string, string>> = {
  fr: { training: "Entraînement", interclub: "Interclub", camp: "Stage", session: "Séance", competition: "Compétition", event: "Événement" },
  de: { training: "Training", interclub: "Interclub", camp: "Camp", session: "Einheit", competition: "Turnier", event: "Veranstaltung" },
  it: { training: "Allenamento", interclub: "Interclub", camp: "Stage", session: "Sessione", competition: "Gara", event: "Evento" },
  en: { training: "Training", interclub: "Interclub", camp: "Camp", session: "Session", competition: "Competition", event: "Event" },
};

export function periodicEventTitle(title: string | null | undefined, eventType: string | null | undefined, locale = "fr") {
  const explicitTitle = String(title ?? "").trim();
  if (explicitTitle) return explicitTitle;
  const language = Object.hasOwn(EVENT_TYPE_LABELS, locale) ? locale : "fr";
  return EVENT_TYPE_LABELS[language][String(eventType ?? "")] ?? EVENT_TYPE_LABELS[language].event;
}

function lastDay(year: number, monthIndex: number) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
function ymd(year: number, monthIndex: number, day: number) { return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10); }

export function previousCivilPeriod(frequency: ReportFrequency, now = new Date()): DateRange {
  const year = now.getUTCFullYear(); const month = now.getUTCMonth();
  const size = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 6;
  const currentBlockStart = Math.floor(month / size) * size;
  const endMonthRaw = currentBlockStart - 1;
  const endYear = endMonthRaw < 0 ? year - 1 : year;
  const endMonth = (endMonthRaw + 12) % 12;
  const startMonthRaw = endMonth - size + 1;
  const startYear = startMonthRaw < 0 ? endYear - 1 : endYear;
  const startMonth = (startMonthRaw + 12) % 12;
  return { from: ymd(startYear, startMonth, 1), to: ymd(endYear, endMonth, lastDay(endYear, endMonth)) };
}

export function nextReportDate(frequency: ReportFrequency, sendDay: number, now = new Date()) {
  const safeDay = Math.min(28, Math.max(1, Math.round(sendDay)));
  const step = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 6;
  let year = now.getUTCFullYear(); let month = now.getUTCMonth();
  let candidate = new Date(Date.UTC(year, month, safeDay, 8));
  if (candidate <= now) { month += step; year += Math.floor(month / 12); month %= 12; candidate = new Date(Date.UTC(year, month, safeDay, 8)); }
  return candidate.toISOString();
}

export function periodLabel(range: DateRange, locale = "fr") {
  const language = ["fr", "de", "it", "en"].includes(locale) ? locale : "fr";
  const formatter = new Intl.DateTimeFormat(`${language}-CH`, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Zurich" });
  return `du ${formatter.format(new Date(`${range.from}T12:00:00Z`))} au ${formatter.format(new Date(`${range.to}T12:00:00Z`))}`;
}

export function deliveryGroupKey(input: { recipientId: string; frequency: ReportFrequency; period: DateRange; sendAt: string; locale: string }) {
  return [input.recipientId, input.frequency, input.period.from, input.period.to, input.sendAt.slice(0, 10), input.locale].join("|");
}
