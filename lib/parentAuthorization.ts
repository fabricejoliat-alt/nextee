export type LegalChild = {
  child_id: string; club_id: string; child_name: string | null; club_name: string | null;
  other_clubs_pending?: string[];
  can_authorize: boolean; representation_verified: boolean; consent_status: string;
  states: Array<{ document_id: string; version_id: string; decision: string; conflict: boolean }>;
};
type ParentDocument = {
  id: string; kind: string; purpose_key: string; club_id: string | null;
  version: { id: string; version_number: number; snapshot: { translations?: Record<string, { title: string }> } } | null;
};
export function parentAuthorizationItems<T extends ParentDocument>(documents: T[], children: LegalChild[], locale: string) {
  return children.filter((child) => child.consent_status !== "adult").map((child) => {
    const matches = documents.filter((doc) => doc.kind === "parent_authorization"
      && doc.purpose_key === "service.parent_authorization" && doc.club_id === child.club_id);
    const doc = matches.length === 1 ? matches[0] : null;
    const state = child.states.find((row) => row.document_id === doc?.id);
    const complete = Boolean(doc?.version && state?.version_id === doc.version.id
      && state.decision === "authorized" && !state.conflict && child.consent_status === "granted");
    const template = doc?.version?.snapshot.translations?.[locale]?.title
      ?? doc?.version?.snapshot.translations?.fr?.title ?? "Autorisation d’utilisation d’ActiviTee";
    return { key: `${child.child_id}:${child.club_id}`, child, doc, complete, conflict: state?.conflict === true,
      title: template.replace(/\{\{\s*child_name\s*\}\}/gi, child.child_name ?? "votre enfant")
        .replace(/\{\{\s*club_name\s*\}\}/gi, child.club_name ?? "votre club") };
  });
}
