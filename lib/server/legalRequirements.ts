import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLegalChecklist } from "@/lib/legalChecklist";
import { loadLegalDocuments } from "@/lib/server/legalDocuments";
import { legalChildren } from "@/lib/server/legalChildren";

export async function loadLegalGateStatus(db: SupabaseClient, actorId: string) {
  const control = await db.from("legal_enforcement_control").select("enabled").eq("singleton", true).maybeSingle();
  if (control.error || !control.data) throw new Error("Legal direct-access gate is unavailable");
  if (!control.data.enabled) return { enabled: false, missing: [] };
  const admin = await db.from("app_admins").select("user_id").eq("user_id", actorId).maybeSingle();
  if (admin.error) throw new Error(admin.error.message);
  // Platform administrators are exempt from account-document acknowledgements.
  // Authentication, MFA and each operation's authorization remain separate gates.
  if (admin.data) return { enabled: true, missing: [] };
  // Entry now waits for every applicable response across the account's
  // organizations, including decisions made by the Parent for each child.
  const [documents, children] = await Promise.all([
    loadLegalDocuments(db, actorId), legalChildren(db, actorId),
  ]);
  const checklist = buildLegalChecklist(documents, children, "fr");
  const neededIds = new Set(checklist.filter(item => item.requiredResponse).map(item => item.doc?.id));
  for (const doc of documents.filter(doc => neededIds.has(doc.id))) {
    if (!doc.version && !doc.required) continue;
    if (doc.applicability?.rule !== "all_members") throw new Error("An active required legal rule is not executable");
    if (!doc.version) throw new Error("An active required legal document has no published version");
    const matching = await db.rpc("legal_version_matches_document", { p_document: doc.id, p_version: doc.version.id });
    if (matching.error || matching.data !== true) throw new Error("Published legal metadata changed");
  }
  const missing = checklist
    .filter(item => item.requiredResponse && !item.complete)
    .map(item => ({ document_id: item.doc?.id ?? item.key, document_key: item.doc?.document_key ?? "parent_authorization",
      kind: item.doc?.kind ?? "parent_authorization", club_id: item.organizationId,
      role: item.child ? "parent" : item.doc?.eligible_role ?? "parent", version_id: item.doc?.version?.id ?? null,
      ...(item.child ? { beneficiary_id: item.child.child_id } : {}) }));
  return { enabled: true, missing };
}

export async function loadMissingLegalActions(db: SupabaseClient, actorId: string) {
  return (await loadLegalGateStatus(db, actorId)).missing;
}
