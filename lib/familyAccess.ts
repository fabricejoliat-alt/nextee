export type AccessStatus = "not_ready" | "ready" | "sent" | "expired" | "activated" | "error";
export type InvitationKind = "parent_access" | "junior_access" | "consent_reminder";

export type FamilyMailConfig = {
  parent_subject: string;
  parent_body: string;
  junior_direct_subject: string;
  junior_direct_body: string;
  junior_parent_subject: string;
  junior_parent_body: string;
  consent_subject: string;
  consent_body: string;
  periodic_report_subject: string;
  periodic_report_body: string;
};

export const PLAYER_GUIDE_URL =
  "https://qgyshibomgcuaxhyhrgo.supabase.co/storage/v1/object/public/Docs/ActiviTee_V1_player.pdf";

export const FAMILY_MAIL_TEMPLATE_DEFINITIONS = [
  {
    key: "parent" as const,
    title: "Invitation au compte parent",
    recipient: "Parent ou représentant légal",
    subjectKey: "parent_subject" as const,
    bodyKey: "parent_body" as const,
    variables: ["club_name", "parent_name", "parent_username", "parent_username_or_existing", "reset_url", "app_url", "player_guide_url"],
  },
  {
    key: "junior_direct" as const,
    title: "Accès junior envoyé directement au junior",
    recipient: "Adresse e-mail personnelle du junior",
    subjectKey: "junior_direct_subject" as const,
    bodyKey: "junior_direct_body" as const,
    variables: ["club_name", "junior_name", "junior_username", "temp_password", "app_url", "player_guide_url"],
  },
  {
    key: "junior_parent" as const,
    title: "Accès junior transmis à un parent",
    recipient: "Parent principal ou parent choisi",
    subjectKey: "junior_parent_subject" as const,
    bodyKey: "junior_parent_body" as const,
    variables: ["club_name", "parent_name", "junior_name", "junior_username", "temp_password", "app_url", "player_guide_url"],
  },
  {
    key: "consent" as const,
    title: "Demande ou rappel de consentement",
    recipient: "Parent ou représentant légal lié au junior",
    subjectKey: "consent_subject" as const,
    bodyKey: "consent_body" as const,
    variables: ["club_name", "parent_name", "junior_name", "consent_url", "app_url"],
  },
  {
    key: "periodic_report" as const,
    title: "Rapport périodique",
    recipient: "Parent ou représentant légal autorisé",
    subjectKey: "periodic_report_subject" as const,
    bodyKey: "periodic_report_body" as const,
    variables: ["club_name", "parent_name", "period_label", "junior_names", "summary", "report_url"],
  },
] as const;

export function defaultFamilyMailConfig(): FamilyMailConfig {
  return {
    parent_subject: "ActiviTee • Votre accès parent pour {{club_name}}",
    parent_body: [
      "Bonjour {{parent_name}},",
      "",
      "Votre accès parent ActiviTee pour {{club_name}} est prêt.",
      "Identifiant : {{parent_username_or_existing}}",
      "Définir ou réinitialiser votre mot de passe : {{reset_url:Cliquez ici}}",
      "Ce lien est valable 7 jours et ne peut être utilisé qu’une fois.",
      "Connexion : {{app_url:Ouvrir ActiviTee}}",
      "Guide : {{player_guide_url:Consulter le guide}}",
      "",
      "L’équipe ActiviTee",
    ].join("\n"),
    junior_direct_subject: "ActiviTee • Tes accès pour {{club_name}}",
    junior_direct_body: [
      "Bonjour {{junior_name}},",
      "",
      "Voici tes accès ActiviTee pour {{club_name}}.",
      "Identifiant : {{junior_username}}",
      "Mot de passe temporaire : {{temp_password}}",
      "Connexion : {{app_url:Ouvrir ActiviTee}}",
      "Guide : {{player_guide_url:Consulter le guide}}",
      "",
      "Pense à modifier ton mot de passe après ta première connexion.",
      "L’équipe ActiviTee",
    ].join("\n"),
    junior_parent_subject: "ActiviTee • Accès de {{junior_name}}",
    junior_parent_body: [
      "Bonjour {{parent_name}},",
      "",
      "Voici les accès ActiviTee de {{junior_name}} pour {{club_name}}.",
      "Identifiant junior : {{junior_username}}",
      "Mot de passe temporaire : {{temp_password}}",
      "Connexion : {{app_url:Ouvrir ActiviTee}}",
      "Guide : {{player_guide_url:Consulter le guide}}",
      "",
      "Merci de transmettre ces accès à votre enfant ou de l’accompagner lors de sa première connexion.",
      "L’équipe ActiviTee",
    ].join("\n"),
    consent_subject: "ActiviTee • Consentement requis pour {{junior_name}}",
    consent_body: [
      "Bonjour {{parent_name}},",
      "",
      "Le consentement pour {{junior_name}} est encore à compléter pour {{club_name}}.",
      "Vous pouvez le renseigner depuis votre espace parent : {{consent_url:Accéder au consentement}}",
      "Connexion : {{app_url:Ouvrir ActiviTee}}",
      "",
      "L’équipe ActiviTee",
    ].join("\n"),
    periodic_report_subject: "ActiviTee • Rapport de {{period_label}} pour {{junior_names}}",
    periodic_report_body: [
      "Bonjour {{parent_name}},",
      "",
      "Le rapport périodique de {{junior_names}} pour {{period_label}} est disponible.",
      "{{summary}}",
      "",
      "Consulter le rapport dans votre espace sécurisé : {{report_url:Ouvrir le rapport}}",
      "",
      "L’équipe {{club_name}}",
    ].join("\n"),
  };
}

export function renderFamilyTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{([a-z0-9_]+)(?::([^}]+))?\}\}/gi, (_match, key: string, label?: string) => {
    const value = variables[key] ?? "";
    if (!value) return "";
    return label ? `${label}: ${value}` : value;
  });
}

export function cleanFamilyEmail(value: string | null | undefined) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || email.endsWith("@noemail.local")) return null;
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

export function familyAccessStatusLabel(status: AccessStatus) {
  return ({
    not_ready: "Informations à compléter",
    ready: "Prêt",
    sent: "Envoyé",
    expired: "Expiré",
    activated: "Activé",
    error: "Erreur",
  } as const)[status];
}
