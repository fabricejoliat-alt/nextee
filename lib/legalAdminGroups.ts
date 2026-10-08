export type LegalAdminGroupDocument = {
  id: string;
  document_key: string;
  kind: string;
  purpose_key: string;
  scope: string;
  club_id: string | null;
  active: boolean;
};

export type LegalAdminGroup<T extends LegalAdminGroupDocument> = {
  key: string;
  label: string;
  shared: boolean;
  documents: T[];
};

export const sharedClubPurposeLabels: Record<string, string> = {
  "service.parent_authorization": "Autorisation parentale",
  "coaching.rewrite": "Reformulation IA pour les juniors",
  "coaching.ai": "Assistance IA pour les majeurs",
};

const platformLabels: Record<string, string> = {
  activitee_conditions_utilisation: "Conditions d’utilisation",
  activitee_notice_donnees_personnelles: "Notice de confidentialité",
  activitee_notice_juniors: "Notice junior",
};

const order = [
  "activitee_conditions_utilisation",
  "activitee_notice_donnees_personnelles",
  "activitee_notice_juniors",
  "service.parent_authorization",
  "coaching.rewrite",
  "coaching.ai",
];

export function legalAdminGroups<T extends LegalAdminGroupDocument>(documents: T[]) {
  const groups = new Map<string, LegalAdminGroup<T>>();
  const fixtures: T[] = [];
  for (const document of documents) {
    if (document.document_key.startsWith("legalqa_")) {
      fixtures.push(document);
      continue;
    }
    const shared = document.document_key.startsWith("activitee_")
      && ["club", "organization"].includes(document.scope) && Object.hasOwn(sharedClubPurposeLabels, document.purpose_key);
    const key = shared ? document.purpose_key : document.document_key;
    const label = shared ? sharedClubPurposeLabels[document.purpose_key]
      : platformLabels[document.document_key] ?? document.document_key;
    const group = groups.get(key) ?? { key, label, shared, documents: [] };
    group.documents.push(document);
    groups.set(key, group);
  }
  return {
    groups: [...groups.values()].sort((a, b) => {
      const ai = order.indexOf(a.key); const bi = order.indexOf(b.key);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.label.localeCompare(b.label, "fr");
    }),
    fixtures,
  };
}
