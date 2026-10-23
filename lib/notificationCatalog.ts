export type NotificationLocale = "fr" | "en" | "de" | "it";
export type NotificationRole = "player" | "coach" | "manager";
export type TemplatePair = { title: string; body: string };
export type NotificationParams = Record<string, string | number | null | undefined>;
export type NotificationTemplate = Record<NotificationLocale, TemplatePair> & {
  label: string; kind: string; trigger: string; roles: NotificationRole[]; variables: string[];
};
export const NOTIFICATION_LOCALES: NotificationLocale[] = ["fr", "en", "de", "it"];
export const notificationTemplateDefaults: Record<string, NotificationTemplate> = {
  "notif.marketplaceMessage": {
    label: "Message du Marketplace", kind: "marketplace_message", roles: ["player"], variables: [],
    trigger: "Après la réception d’un message ou d’une réponse dans le Marketplace, selon les préférences du destinataire et de ses parents autorisés.",
    fr: { title: "Nouveau message du Marketplace", body: "Un nouveau message est disponible dans le Marketplace." },
    en: { title: "New Marketplace message", body: "A new message is available in the Marketplace." },
    de: { title: "Neue Marketplace-Nachricht", body: "Im Marketplace ist eine neue Nachricht verfügbar." },
    it: { title: "Nuovo messaggio del Marketplace", body: "È disponibile un nuovo messaggio nel Marketplace." },
  },
  "notif.coachEventCreated": {
    "label": "Nouvelle activité",
    "kind": "coach_event_created",
    "trigger": "Après la création confirmée d’une activité.",
    "roles": [
      "player",
      "coach"
    ],
    "variables": [
      "eventType",
      "dateTime",
      "locationPart"
    ],
    "fr": {
      "title": "Nouvelle activité planifiée",
      "body": "{eventType} · {dateTime} {locationPart}"
    },
    "en": {
      "title": "New activity scheduled",
      "body": "{eventType} · {dateTime} {locationPart}"
    },
    "de": {
      "title": "Neue Aktivität geplant",
      "body": "{eventType} · {dateTime} {locationPart}"
    },
    "it": {
      "title": "Nuova attività programmata",
      "body": "{eventType} · {dateTime} {locationPart}"
    }
  },
  "notif.coachEventsCreated": {
    "label": "Série d’activités créée",
    "kind": "coach_event_created",
    "trigger": "Après la création confirmée d’une série.",
    "roles": [
      "player",
      "coach"
    ],
    "variables": [
      "changesSummary"
    ],
    "fr": {
      "title": "Nouvelles activités planifiées",
      "body": "{changesSummary}"
    },
    "en": {
      "title": "New activities scheduled",
      "body": "{changesSummary}"
    },
    "de": {
      "title": "Neue Aktivitäten geplant",
      "body": "{changesSummary}"
    },
    "it": {
      "title": "Nuove attività programmate",
      "body": "{changesSummary}"
    }
  },
  "notif.coachEventUpdated": {
    "label": "Activité modifiée",
    "kind": "coach_event_updated",
    "trigger": "Après une modification visible pour les participants.",
    "roles": [
      "player",
      "coach"
    ],
    "variables": [
      "changesSummary"
    ],
    "fr": {
      "title": "Activité modifiée",
      "body": "{changesSummary}"
    },
    "en": {
      "title": "Activity updated",
      "body": "{changesSummary}"
    },
    "de": {
      "title": "Aktivität geändert",
      "body": "{changesSummary}"
    },
    "it": {
      "title": "Attività modificata",
      "body": "{changesSummary}"
    }
  },
  "notif.coachSeriesUpdated": {
    "label": "Série modifiée",
    "kind": "coach_event_updated",
    "trigger": "Après la modification confirmée d’une série.",
    "roles": [
      "player",
      "coach"
    ],
    "variables": [
      "changesSummary"
    ],
    "fr": {
      "title": "Série d’activités modifiée",
      "body": "{changesSummary}"
    },
    "en": {
      "title": "Activity series updated",
      "body": "{changesSummary}"
    },
    "de": {
      "title": "Aktivitätsserie geändert",
      "body": "{changesSummary}"
    },
    "it": {
      "title": "Serie di attività modificata",
      "body": "{changesSummary}"
    }
  },
  "notif.coachEventDeleted": {
    "label": "Activité annulée",
    "kind": "coach_event_deleted",
    "trigger": "Après l’annulation confirmée d’une activité.",
    "roles": [
      "player",
      "coach"
    ],
    "variables": [
      "eventType",
      "dateTime",
      "locationPart"
    ],
    "fr": {
      "title": "Activité annulée",
      "body": "{eventType} · {dateTime} {locationPart}"
    },
    "en": {
      "title": "Activity cancelled",
      "body": "{eventType} · {dateTime} {locationPart}"
    },
    "de": {
      "title": "Aktivität abgesagt",
      "body": "{eventType} · {dateTime} {locationPart}"
    },
    "it": {
      "title": "Attività annullata",
      "body": "{eventType} · {dateTime} {locationPart}"
    }
  },
  "notif.coachSeriesDeleted": {
    "label": "Série annulée",
    "kind": "coach_event_deleted",
    "trigger": "Après l’annulation confirmée d’une série.",
    "roles": [
      "player",
      "coach"
    ],
    "variables": [
      "changesSummary"
    ],
    "fr": {
      "title": "Série d’activités annulée",
      "body": "{changesSummary}"
    },
    "en": {
      "title": "Activity series cancelled",
      "body": "{changesSummary}"
    },
    "de": {
      "title": "Aktivitätsserie abgesagt",
      "body": "{changesSummary}"
    },
    "it": {
      "title": "Serie di attività annullata",
      "body": "{changesSummary}"
    }
  },
  "notif.coachPlayerEvaluated": {
    "label": "Évaluation disponible pour le joueur",
    "kind": "coach_player_evaluated",
    "trigger": "Après l’enregistrement d’une évaluation individuelle par le coach. Le joueur et ses parents autorisés sont destinataires.",
    "roles": [
      "player"
    ],
    "variables": [
      "playerName",
      "eventType",
      "dateTime"
    ],
    "fr": {
      "title": "Nouvelle évaluation coach",
      "body": "L’évaluation de {playerName} du {dateTime} est disponible."
    },
    "en": {
      "title": "New coach evaluation",
      "body": "The evaluation for {playerName} from {dateTime} is available."
    },
    "de": {
      "title": "Neue Trainerbewertung",
      "body": "Die Bewertung von {playerName} vom {dateTime} ist verfügbar."
    },
    "it": {
      "title": "Nuova valutazione del coach",
      "body": "La valutazione di {playerName} del {dateTime} è disponibile."
    }
  },
  "notif.playerMarkedAbsent": {
    "label": "Absence signalée au coach",
    "kind": "player_marked_absent",
    "trigger": "Lorsqu’un joueur ou son parent change sa présence en absent.",
    "roles": [
      "coach"
    ],
    "variables": [
      "playerName",
      "eventType",
      "dateTime"
    ],
    "fr": {
      "title": "Absence signalée",
      "body": "{playerName} sera absent · {eventType} · {dateTime}"
    },
    "en": {
      "title": "Absence reported",
      "body": "{playerName} will be absent · {eventType} · {dateTime}"
    },
    "de": {
      "title": "Abwesenheit gemeldet",
      "body": "{playerName} wird abwesend sein · {eventType} · {dateTime}"
    },
    "it": {
      "title": "Assenza segnalata",
      "body": "{playerName} sarà assente · {eventType} · {dateTime}"
    }
  },
  "notif.playerMarkedPresent": {
    "label": "Présence confirmée au coach",
    "kind": "player_marked_present",
    "trigger": "Lorsqu’un joueur ou son parent confirme sa présence.",
    "roles": [
      "coach"
    ],
    "variables": [
      "playerName",
      "eventType",
      "dateTime"
    ],
    "fr": {
      "title": "Présence confirmée",
      "body": "{playerName} sera présent · {eventType} · {dateTime}"
    },
    "en": {
      "title": "Attendance confirmed",
      "body": "{playerName} will attend · {eventType} · {dateTime}"
    },
    "de": {
      "title": "Anwesenheit bestätigt",
      "body": "{playerName} wird teilnehmen · {eventType} · {dateTime}"
    },
    "it": {
      "title": "Presenza confermata",
      "body": "{playerName} sarà presente · {eventType} · {dateTime}"
    }
  },
  "notif.threadMessage": {
    "label": "Nouveau message",
    "kind": "thread_message",
    "trigger": "Après l’envoi d’un message dans une discussion autorisée.",
    "roles": [
      "player",
      "coach"
    ],
    "variables": [
      "threadName",
      "count"
    ],
    "fr": {
      "title": "Nouveau message",
      "body": "{threadName} · {count} message(s) à lire"
    },
    "en": {
      "title": "New message",
      "body": "{threadName} · {count} unread message(s)"
    },
    "de": {
      "title": "Neue Nachricht",
      "body": "{threadName} · {count} ungelesene Nachricht(en)"
    },
    "it": {
      "title": "Nuovo messaggio",
      "body": "{threadName} · {count} messaggio/i da leggere"
    }
  },
  "notif.competitionReminder": {
    "label": "Rappel de compétition",
    "kind": "competition_reminder",
    "trigger": "À l’heure du rappel programmé par le club (vérification toutes les cinq minutes).",
    "roles": [
      "player"
    ],
    "variables": [
      "competitionName",
      "message"
    ],
    "fr": {
      "title": "Rappel compétition · {competitionName}",
      "body": "{message}"
    },
    "en": {
      "title": "Competition reminder · {competitionName}",
      "body": "{message}"
    },
    "de": {
      "title": "Wettkampferinnerung · {competitionName}",
      "body": "{message}"
    },
    "it": {
      "title": "Promemoria gara · {competitionName}",
      "body": "{message}"
    }
  }
};

notificationTemplateDefaults["notif.managerNews"] = {
  label: "Actualité du club", kind: "manager_news", trigger: "À la publication d’une actualité avec l’option notification activée, auprès des destinataires choisis par le club.",
  roles: ["player", "coach", "manager"], variables: ["newsTitle", "newsSummary"],
  fr: { title: "Actualité · {newsTitle}", body: "{newsSummary}" }, en: { title: "News · {newsTitle}", body: "{newsSummary}" },
  de: { title: "Neuigkeit · {newsTitle}", body: "{newsSummary}" }, it: { title: "Novità · {newsTitle}", body: "{newsSummary}" },
};

export const notificationVariableExamples: Record<string, string> = {
  newsTitle: "Rencontre des juniors", newsSummary: "Rendez-vous samedi pour la rencontre du club.",
  playerName: "Léa Martin", eventType: "Entraînement", dateTime: "20.10.2026 à 17:00",
  locationPart: "Practice", changesSummary: "Entraînement déplacé au 20.10.2026 à 17:00 · Practice",
  threadName: "Groupe Juniors", count: "2", competitionName: "Tournoi juniors", message: "Les inscriptions se terminent le 18 octobre.",
};
export function templateVariables(text: string) { return [...new Set([...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match => match[1]))].sort(); }
export function validateNotificationTemplate(key: string, pair: TemplatePair) {
  const definition = notificationTemplateDefaults[key];
  if (!Object.hasOwn(notificationTemplateDefaults, key)) return "Modèle inconnu.";
  if (typeof pair?.title !== "string" || typeof pair?.body !== "string" || !pair.title.trim() || !pair.body.trim()) return "Renseignez le titre et le message.";
  if (pair.title.length > 160 || pair.body.length > 1200) return "Maximum : 160 caractères pour le titre et 1 200 pour le message.";
  const text = pair.title + pair.body;
  if (/[{}]/.test(text.replace(/\{[a-zA-Z0-9_]+\}/g, ""))) return "Une variable contient des accolades invalides.";
  const unknown = templateVariables(text).filter(variable => !definition.variables.includes(variable));
  return unknown.length ? `Variable inconnue : ${unknown.join(", ")}.` : null;
}
export function notificationTranslationsMatch(source: TemplatePair, target: TemplatePair) {
  return ["title", "body"].every(field => JSON.stringify(templateVariables(source[field as keyof TemplatePair])) === JSON.stringify(templateVariables(target[field as keyof TemplatePair])));
}
export function renderNotificationTemplate(key: string, locale: NotificationLocale, params: NotificationParams = {}, overrides: Record<string, string> = {}) {
  const definition = notificationTemplateDefaults[key];
  if (!definition) throw new Error("Unknown notification template");
  const eventLabels: Record<string, Record<NotificationLocale, string>> = {
    "Entraînement": { fr: "Entraînement", en: "Training", de: "Training", it: "Allenamento" },
    "Training": { fr: "Entraînement", en: "Training", de: "Training", it: "Allenamento" },
    "Activité": { fr: "Activité", en: "Activity", de: "Aktivität", it: "Attività" },
  };
  params = { ...params, ...(params.locationPart != null ? { locationPart: String(params.locationPart).replace(/^\s*[·•]\s*/, "").trim() } : {}), ...(params.eventType && eventLabels[String(params.eventType)] ? { eventType: eventLabels[String(params.eventType)][locale] } : {}) };
  const fill = (text: string) => text.replace(/\{dateTime\}\{locationPart\}/g, "{dateTime} {locationPart}")
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, variable) => String(params[variable] ?? ""));
  return { title: fill(overrides[`${key}.title`] || definition[locale].title), body: fill(overrides[`${key}.body`] || definition[locale].body) };
}
export function notificationKindsForRole(role: NotificationRole) {
  return [...new Set(Object.values(notificationTemplateDefaults).filter(template => template.roles.includes(role)).map(template => template.kind))];
}
