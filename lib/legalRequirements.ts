export type LegalMembership = { club_id: string | null; organization_id?: string | null; role: string };
export type RequiredLegalDocument = {
  id: string;
  document_key: string;
  kind: string;
  scope: "platform" | "club" | "organization";
  club_id: string | null;
  organization_id?: string | null;
  audience_roles: string[];
  action_kind: string;
  required: boolean;
  active: boolean;
};
export type LegalVersionRef = { id: string; document_id: string; version_number: number };
export type LegalStateRef = { document_id: string; version_id: string; club_scope: string | null; decision: string; conflict: boolean };

const requiredDecision: Record<string, string> = {
  accept: "accepted", acknowledge: "acknowledged", read: "acknowledged",
};

export function eligibleLegalRole(doc: RequiredLegalDocument, memberships: LegalMembership[], isAdmin: boolean) {
  return doc.audience_roles.find((role) => role === "admin" && isAdmin && doc.scope === "platform"
    || memberships.some((membership) => membership.role === role
      && (doc.scope === "platform" || (membership.organization_id ?? membership.club_id) === (doc.organization_id ?? doc.club_id))));
}

export function findMissingLegalActions(input: {
  memberships: LegalMembership[];
  isAdmin: boolean;
  documents: RequiredLegalDocument[];
  versions: LegalVersionRef[];
  states: LegalStateRef[];
}) {
  const latest = new Map<string, LegalVersionRef>();
  for (const version of [...input.versions].sort((a, b) => b.version_number - a.version_number)) {
    if (!latest.has(version.document_id)) latest.set(version.document_id, version);
  }
  return input.documents.flatMap((doc) => {
    if (!doc.active || !doc.required || !["terms", "privacy", "junior_notice"].includes(doc.kind)) return [];
    const eligible = eligibleLegalRole(doc, input.memberships, input.isAdmin);
    if (!eligible) return [];
    const version = latest.get(doc.id);
    const state = input.states.find((entry) => entry.document_id === doc.id && entry.club_scope === doc.club_id);
    const expected = requiredDecision[doc.action_kind];
    if (version && expected && state?.version_id === version.id && state.decision === expected && !state.conflict) return [];
    return [{ document_id: doc.id, document_key: doc.document_key, kind: doc.kind,
      club_id: doc.club_id, role: eligible, version_id: version?.id ?? null }];
  });
}
