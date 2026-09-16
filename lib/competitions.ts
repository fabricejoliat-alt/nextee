export const COMPETITION_LEVELS = [
  "internal",
  "club",
  "regional",
  "national",
  "international",
] as const;

export const COMPETITION_CATEGORIES = ["u10", "u12", "u14", "u16", "u18", "all"] as const;

export const REMINDER_CHANNELS = ["in_app", "email", "both"] as const;

export type CompetitionLevel = (typeof COMPETITION_LEVELS)[number];
export type CompetitionCategory = (typeof COMPETITION_CATEGORIES)[number];
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export type CompetitionPlayer = {
  id: string;
  birthDate: string | null | undefined;
};

const CATEGORY_MAX_AGE: Record<Exclude<CompetitionCategory, "all">, number> = {
  u10: 10,
  u12: 12,
  u14: 14,
  u16: 16,
  u18: 18,
};

export function competitionAgeInYear(birthDate: string | null | undefined, tournamentYear: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate ?? "").trim());
  if (!match || !Number.isInteger(tournamentYear)) return null;
  const birthYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (birthYear < 1900 || month < 1 || month > 12 || day < 1 || day > 31 || birthYear > tournamentYear) return null;
  const parsed = new Date(Date.UTC(birthYear, month - 1, day));
  if (parsed.getUTCFullYear() !== birthYear || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return tournamentYear - birthYear;
}

export function competitionTournamentYear(startDate: string, endDate: string) {
  const parseYear = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      year < 1900 ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) return null;
    return year;
  };
  const startYear = parseYear(startDate);
  const endYear = parseYear(endDate);
  if (startYear == null || endYear == null) {
    return { year: null, error: "Les dates de la compétition sont invalides." } as const;
  }
  if (startYear !== endYear) {
    return {
      year: null,
      error: "La compétition doit commencer et se terminer durant la même année civile.",
    } as const;
  }
  return { year: startYear, error: null } as const;
}

export function competitionBoundaryIso(
  date: string,
  boundary: "start" | "end",
  timeZone = "Europe/Zurich",
) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;

  const hour = boundary === "start" ? 0 : 23;
  const minute = boundary === "start" ? 0 : 59;
  const second = boundary === "start" ? 0 : 59;
  const millisecond = boundary === "start" ? 0 : 999;
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  let instant = wallClockAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    const renderedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      millisecond,
    );
    instant -= renderedAsUtc - wallClockAsUtc;
  }
  return new Date(instant).toISOString();
}

export function isPlayerEligibleForCompetition(
  birthDate: string | null | undefined,
  tournamentYear: number,
  category: CompetitionCategory,
) {
  const age = competitionAgeInYear(birthDate, tournamentYear);
  if (age == null) return false;
  return category === "all" || age <= CATEGORY_MAX_AGE[category];
}

export function selectCompetitionPlayerIds(
  players: CompetitionPlayer[],
  tournamentYear: number,
  category: CompetitionCategory,
) {
  return players
    .filter((player) => isPlayerEligibleForCompetition(player.birthDate, tournamentYear, category))
    .map((player) => player.id);
}

export function applyManualCompetitionSelection(
  automaticIds: string[],
  addedIds: string[] = [],
  removedIds: string[] = [],
) {
  const selected = new Set([...automaticIds, ...addedIds].filter(Boolean));
  removedIds.forEach((id) => selected.delete(id));
  return Array.from(selected);
}

export function competitionSupportsInternalAttendance(eventType: string | null | undefined) {
  return eventType !== "competition";
}

export function competitionRequiresCoach() {
  return false;
}

export function reminderChannelFlags(channel: ReminderChannel) {
  return {
    inApp: channel === "in_app" || channel === "both",
    email: channel === "email" || channel === "both",
  };
}

export function isReminderDispatchable(status: string | null | undefined, sentAt: string | null | undefined) {
  return status === "pending" && !sentAt;
}

export function renderCompetitionReminderTemplate(
  template: string,
  variables: Record<
    "competition_name" | "start_date" | "end_date" | "level" | "category" | "external_registration_url",
    string
  >,
) {
  return String(template ?? "").replace(
    /\{(competition_name|start_date|end_date|level|category|external_registration_url)\}/g,
    (_match, key: keyof typeof variables) => variables[key] ?? "",
  );
}

export function isHttpUrl(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return true;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
