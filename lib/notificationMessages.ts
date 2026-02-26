export type NotificationLocale = "fr" | "en";

type TemplatePair = {
  title: string;
  body: string;
};

export const notificationTemplateDefaults: Record<string, { fr: TemplatePair; en: TemplatePair; label: string }> = {
  "notif.coachEventCreated": {
    label: "Coach: événement créé",
    fr: { title: "Nouvel événement planifié", body: "{eventType} · {dateTime}" },
    en: { title: "New event scheduled", body: "{eventType} · {dateTime}" },
  },
  "notif.coachEventsCreated": {
    label: "Coach: récurrence créée",
    fr: { title: "Nouveaux événements planifiés", body: "{count} occurrence(s) {eventType} ajoutée(s)." },
    en: { title: "New events scheduled", body: "{count} {eventType} occurrence(s) added." },
  },
  "notif.coachEventDeleted": {
    label: "Coach: événement supprimé",
    fr: { title: "Événement supprimé", body: "Un événement planifié a été supprimé." },
    en: { title: "Event deleted", body: "A planned event was deleted." },
  },
  "notif.coachEventUpdated": {
    label: "Coach: événement modifié",
    fr: { title: "Événement modifié", body: "Date/heure/lieu mis à jour · {dateTime}" },
    en: { title: "Event updated", body: "Date/time/location updated · {dateTime}" },
  },
  "notif.coachSeriesUpdated": {
    label: "Coach: récurrence modifiée",
    fr: { title: "Récurrence modifiée", body: "Planning des occurrences mis à jour." },
    en: { title: "Recurrence updated", body: "Occurrence schedule updated." },
  },
  "notif.coachSeriesDeleted": {
    label: "Coach: récurrence supprimée",
    fr: { title: "Récurrence supprimée", body: "Une série d'événements planifiés a été supprimée." },
    en: { title: "Recurrence deleted", body: "A series of planned events was deleted." },
  },
  "notif.coachPlayerEvaluated": {
    label: "Coach: joueur évalué",
    fr: { title: "Nouvelle évaluation", body: "{playerName} · {dateTime}" },
    en: { title: "New evaluation", body: "{playerName} · {dateTime}" },
  },
  "notif.playerMarkedAbsent": {
    label: "Player: absent",
    fr: { title: "Absence signalée", body: "Un joueur s'est déclaré absent pour un événement." },
    en: { title: "Absence reported", body: "A player marked themselves absent for an event." },
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
