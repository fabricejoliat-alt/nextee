import type { ChecklistDocument } from "../../lib/legalChecklist.ts";
import type { LegalChild } from "../../lib/parentAuthorization.ts";

export const checklistDoc = (id: string, club: string | null, kind = "specific_consent"): ChecklistDocument => ({
  id, document_key: id, kind, purpose_key: kind === "parent_authorization" ? "service.parent_authorization" : id,
  scope: club ? "organization" : "platform", club_id: club, club_name: club ? `Organisation ${club}` : null,
  audience_roles: ["parent"], eligible_role: "parent", action_kind: kind === "terms" ? "accept" : kind === "parent_authorization" ? "authorize" : "consent",
  required: kind === "terms", applicability: { rule: "all_members" },
  version: { id: `v-${id}`, version_number: 1, snapshot: { translations: { fr: { title: id } } } },
  own_choice: null, state: { version_id: `v-${id}`, decision: kind === "terms" ? "accepted" : "refused", conflict: false },
});
export const checklistChild = (id: string, club: string): LegalChild => ({ child_id: id, child_name: `Enfant ${id}`,
  club_id: club, club_name: `Organisation ${club}`, can_authorize: true, representation_verified: true, consent_status: "granted",
  states: [{ document_id: `authorization-${club}`, version_id: `v-authorization-${club}`, decision: "authorized", conflict: false },
    { document_id: `consent-${club}`, version_id: `v-consent-${club}`, decision: "refused", conflict: false }] });
