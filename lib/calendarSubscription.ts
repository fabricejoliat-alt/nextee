export type CalendarKind = "player" | "coach" | "manager";
export type CalendarLocale = "fr" | "en" | "de" | "it";
export type CalendarScope = { kind: CalendarKind; playerId?: string; organizationId?: string };
export type CalendarEntry = {
  id: string; startsAt: string; endsAt?: string | null; durationMinutes?: number | null;
  title: string; location?: string | null; description?: string; url: string; cancelled?: boolean; transparent?: boolean;
};

export function calendarLocale(value: unknown): CalendarLocale {
  return value === "en" || value === "de" || value === "it" ? value : "fr";
}

export function calendarUrls(origin: string, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid calendar token");
  const url = new URL(`/api/calendar/feed/${token}/planning.ics`, origin);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid calendar origin");
  return { httpsUrl: url.href, subscriptionUrl: url.href.replace(/^https?:/, "webcal:") };
}

function text(value: string) {
  return value.replace(/\r\n|\r/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** RFC 5545 folds at 75 octets, without splitting a UTF-8 character. */
function fold(line: string) {
  const encoder = new TextEncoder();
  let length = 0, result = "";
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) { result += "\r\n "; length = 1; }
    result += character; length += bytes;
  }
  return result;
}

function stamp(value: number) { return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }

export function renderCalendar(name: string, entries: CalendarEntry[], now = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ActiviTee//Planning//FR", "CALSCALE:GREGORIAN",
    `NAME:${text(name)}`, `X-WR-CALNAME:${text(name)}`, "X-WR-TIMEZONE:Europe/Zurich",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  const seen = new Set<string>();
  for (const entry of [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))) {
    const start = Date.parse(entry.startsAt);
    if (!Number.isFinite(start) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const suppliedEnd = Date.parse(entry.endsAt ?? "");
    const minutes = Number.isFinite(entry.durationMinutes) && Number(entry.durationMinutes) > 0 ? Number(entry.durationMinutes) : 60;
    const end = suppliedEnd > start ? suppliedEnd : start + minutes * 60_000;
    // URLs are app-owned, never user-entered links or the private subscription URL.
    const url = new URL(entry.url);
    if (!["https:", "http:"].includes(url.protocol)) continue;
    lines.push("BEGIN:VEVENT", `UID:${text(entry.id)}@calendar.activitee.app`, `DTSTAMP:${stamp(now.getTime())}`,
      `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${text(entry.title)}`,
      `LOCATION:${text(entry.location ?? "")}`, `DESCRIPTION:${text(entry.description ?? "")}`,
      `URL:${url.href}`, `STATUS:${entry.cancelled ? "CANCELLED" : "CONFIRMED"}`, `TRANSP:${entry.transparent ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
