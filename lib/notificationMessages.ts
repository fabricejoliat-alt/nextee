export type NotificationLocale = "fr" | "en";

type TemplatePair = {
  title: string;
  body: string;
};

export const notificationTemplateDefaults: Record<string, { fr: TemplatePair; en: TemplatePair; label: string }> = {
  "notif.coachEventCreated": {
    label: "Coach: événement créé",
    fr: { title: "Nouvel événement planifié", body: "{eventType} · {dateTime}{locationPart}" },
    en: { title: "New event scheduled", body: "{eventType} · {dateTime}{locationPart}" },
  },
  "notif.coachEventsCreated": {
    label: "Coach: récurrence créée",
    fr: { title: "Nouveaux événements planifiés", body: "{changesSummary}" },
    en: { title: "New events scheduled", body: "{changesSummary}" },
  },
  "notif.coachEventDeleted": {
    label: "Coach: événement supprimé",
    fr: { title: "Événement supprimé", body: "{eventType} · {dateTime}{locationPart}" },
    en: { title: "Event deleted", body: "{eventType} · {dateTime}{locationPart}" },
  },
  "notif.coachEventUpdated": {
    label: "Coach: événement modifié",
    fr: { title: "Événement modifié", body: "{changesSummary}" },
    en: { title: "Event updated", body: "{changesSummary}" },
  },
  "notif.coachSeriesUpdated": {
    label: "Coach: récurrence modifiée",
    fr: { title: "Récurrence modifiée", body: "{changesSummary}" },
    en: { title: "Recurrence updated", body: "{changesSummary}" },
  },
  "notif.coachSeriesDeleted": {
    label: "Coach: récurrence supprimée",
    fr: { title: "Récurrence supprimée", body: "{changesSummary}" },
    en: { title: "Recurrence deleted", body: "{changesSummary}" },
  },
  "notif.coachPlayerEvaluated": {
    label: "Coach: joueur évalué",
    fr: { title: "Nouvelle évaluation", body: "{playerName} · {eventType} · {dateTime}" },
    en: { title: "New evaluation", body: "{playerName} · {eventType} · {dateTime}" },
  },
  "notif.playerMarkedAbsent": {
    label: "Player: absent",
    fr: { title: "Absence signalée", body: "{playerName} absent · {eventType} · {dateTime}" },
    en: { title: "Absence reported", body: "{playerName} absent · {eventType} · {dateTime}" },
  },
};

type Params = Record<string, string | number | null | undefined>;

const overridesByLocale = new Map<NotificationLocale, Record<string, string>>();
const inFlightByLocale = new Map<NotificationLocale, Promise<Record<string, string>>>();

function fillTemplate(template: string, params: Params) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const value = params[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

async function loadOverrides(locale: NotificationLocale) {
  const cached = overridesByLocale.get(locale);
  if (cached) return cached;

  const pending = inFlightByLocale.get(locale);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(`/api/i18n/messages?locale=${locale}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return {};
      const map = (json.overrides ?? {}) as Record<string, string>;
      overridesByLocale.set(locale, map);
      return map;
    } catch {
      return {};
    } finally {
      inFlightByLocale.delete(locale);
    }
  })();

  inFlightByLocale.set(locale, p);
  return p;
}

export async function getNotificationMessage(
  key: keyof typeof notificationTemplateDefaults,
  locale: NotificationLocale,
  params: Params = {}
) {
  const def = notificationTemplateDefaults[key];
  const base = locale === "en" ? def.en : def.fr;

  const overrides = await loadOverrides(locale);
  const titleOverride = overrides[`${key}.title`];
  const bodyOverride = overrides[`${key}.body`];

  const title = fillTemplate(titleOverride || base.title, params);
  const body = fillTemplate(bodyOverride || base.body, params);
  return { title, body };
}
