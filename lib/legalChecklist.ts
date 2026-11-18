import { legalResponseComplete } from "./legalRequirements.ts";
import { parentAuthorizationItems, type LegalChild } from "./parentAuthorization.ts";

export type ChecklistDocument = {
  id: string; document_key: string; kind: string; purpose_key: string; scope: string;
  club_id: string | null; club_name: string | null; audience_roles: string[]; eligible_role: string | null;
  action_kind: string; required: boolean;
  applicability?: { rule?: string } | null;
  version: { id: string; version_number: number; snapshot: { translations?: Record<string, { title: string; body?: string; action_label?: string }> } } | null;
  own_choice: { version_id: string; decision: string } | null;
  state: { version_id: string; decision: string; conflict: boolean } | null;
};
export type LegalChecklistItem<T extends ChecklistDocument = ChecklistDocument> = {
  key: string; doc: T | null; child: LegalChild | null; title: string;
  organizationId: string | null; organizationName: string; complete: boolean; decision: string | null;
  actionable: boolean; requiredResponse: boolean; note: string | null;
};

export function legalDocumentNeedsChild(doc: { kind: string; version?: ChecklistDocument["version"] }) {
  return doc.kind === "parent_authorization" || Object.values(doc.version?.snapshot?.translations ?? {})
    .some(text => /\{\{\s*child_name\s*\}\}/i.test(`${text.title} ${text.body ?? ""} ${text.action_label ?? ""}`));
}

export function buildLegalChecklist<T extends ChecklistDocument>(documents: T[], children: LegalChild[], locale: string) {
  const items: LegalChecklistItem<T>[] = [];
  const title = (doc: T, child?: LegalChild) => (doc.version?.snapshot?.translations?.[locale]?.title
    ?? doc.version?.snapshot?.translations?.fr?.title ?? doc.document_key)
    .replace(/\{\{\s*(?:club_name|organization_name)\s*\}\}/gi, doc.club_name ?? "ActiviTee")
    .replace(/\{\{\s*child_name\s*\}\}/gi, child?.child_name ?? "votre enfant");
  for (const doc of documents) {
    if (!doc.eligible_role || legalDocumentNeedsChild(doc) || (!doc.required && !doc.version)) continue;
    const choice = doc.purpose_key === "coaching.rewrite" ? doc.own_choice : doc.state;
    items.push({ key: `${doc.id}:self`, doc, child: null, title: title(doc), organizationId: doc.club_id,
      organizationName: doc.club_name ?? "ActiviTee", complete: legalResponseComplete(doc, doc.version?.id, choice),
      decision: choice?.version_id === doc.version?.id ? choice?.decision ?? null : null,
      actionable: Boolean(doc.version), requiredResponse: true, note: doc.version ? null : "Le document n’est pas disponible. Contactez votre organisation." });
  }
  for (const item of parentAuthorizationItems(documents, children, locale)) {
    if (!item.doc?.version && item.child.consent_status === "granted") continue;
    const requiredResponse = item.child.can_authorize || item.child.representation_verified;
    items.push({ key: `authorization:${item.key}`, doc: item.doc, child: item.child, title: item.title,
      organizationId: item.child.club_id, organizationName: item.child.club_name ?? "Votre organisation", complete: item.complete,
      decision: item.child.states.find(state => state.document_id === item.doc?.id && state.version_id === item.doc?.version?.id)?.decision ?? null,
      actionable: Boolean(item.doc?.version && item.child.can_authorize), requiredResponse,
      note: !item.doc?.version ? "Le document n’est pas disponible. Contactez votre organisation."
        : !item.child.can_authorize ? "Votre organisation doit vérifier votre habilitation pour cet enfant." : null });
  }
  const seen = new Set<string>();
  const sortedChildren = [...children].sort((a, b) => Number(b.can_decide ?? b.representation_verified) - Number(a.can_decide ?? a.representation_verified));
  for (const child of sortedChildren) {
    if (child.consent_status === "adult") continue;
    for (const doc of documents) {
      if (!doc.version || !doc.audience_roles.includes("parent") || !["specific_consent", "parent_authorization"].includes(doc.kind)
        || doc.purpose_key === "service.parent_authorization" || (doc.scope !== "platform" && doc.club_id !== child.club_id)) continue;
      const key = `${doc.id}:${child.child_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const state = (child.own_choices ?? child.states).find(state => state.document_id === doc.id);
      items.push({ key, doc, child, title: title(doc, child), organizationId: doc.club_id,
        organizationName: doc.club_name ?? "ActiviTee", complete: legalResponseComplete(doc, doc.version.id, state),
        decision: state?.version_id === doc.version.id ? state.decision : null,
        actionable: child.can_decide ?? child.representation_verified, requiredResponse: child.can_authorize || child.representation_verified,
        note: (child.can_decide ?? child.representation_verified) ? null : "Votre organisation doit vérifier le lien parent–enfant et vos droits de modification." });
    }
  }
  return items.sort((a, b) => Number(a.organizationId !== null) - Number(b.organizationId !== null)
    || a.organizationName.localeCompare(b.organizationName, locale)
    || Number(Boolean(a.child)) - Number(Boolean(b.child))
    || (a.child?.child_name ?? "").localeCompare(b.child?.child_name ?? "", locale)
    || (a.child?.child_id ?? "").localeCompare(b.child?.child_id ?? "")
    || Number(b.doc?.kind === "parent_authorization") - Number(a.doc?.kind === "parent_authorization")
    || a.title.localeCompare(b.title, locale));
}
