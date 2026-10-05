import type { SupabaseClient } from "@supabase/supabase-js";
import { eligibleLegalRole, findMissingLegalActions, type RequiredLegalDocument } from "@/lib/legalRequirements";

export async function loadMissingLegalActions(db: SupabaseClient, actorId: string) {
  // HTTP enforcement must fail closed while the database direct-access layer is
  // deliberately locked off. The public legal routes do not call this helper.
  const control = await db.from("legal_enforcement_control").select("enabled").eq("singleton", true).maybeSingle();
  if (control.error || control.data?.enabled !== true) throw new Error("Legal direct-access gate is not ready");
  const [memberships, admin, docs] = await Promise.all([
    db.from("club_members").select("club_id,role").eq("user_id", actorId).eq("is_active", true),
    db.from("app_admins").select("user_id").eq("user_id", actorId).maybeSingle(),
    db.from("legal_documents").select("id,document_key,kind,scope,club_id,audience_roles,action_kind,required,active,applicability")
      .eq("active", true).eq("required", true),
  ]);
  for (const result of [memberships, admin, docs]) if (result.error) throw new Error(result.error.message);
  const applicableDocs = (docs.data ?? []).filter((doc) =>
    eligibleLegalRole(doc as RequiredLegalDocument, memberships.data ?? [], Boolean(admin.data)));
  for (const doc of applicableDocs) {
    if (["terms", "privacy", "junior_notice"].includes(doc.kind)
      && (doc.applicability as { rule?: string } | null)?.rule !== "all_members") {
      throw new Error("An active required legal rule is not executable");
    }
  }
  const documentIds = applicableDocs.map((doc) => doc.id);
  if (!documentIds.length) return [];
  const [versions, states] = await Promise.all([
    db.from("legal_versions").select("id,document_id,version_number").in("document_id", documentIds),
    db.from("legal_current_state").select("document_id,version_id,club_scope,decision,conflict")
      .eq("beneficiary_id", actorId).in("document_id", documentIds),
  ]);
  if (versions.error || states.error) throw new Error(versions.error?.message ?? states.error?.message);
  for (const doc of applicableDocs) {
    if (!["terms", "privacy", "junior_notice"].includes(doc.kind)) continue;
    const latest = (versions.data ?? []).filter((version) => version.document_id === doc.id)
      .sort((a, b) => b.version_number - a.version_number)[0];
    if (!latest) {
      throw new Error("An active required legal document has no published version");
    }
    // The decision/presentation RPCs already reject changed published metadata.
    // Apply the same invariant before letting an old acceptance unlock business data.
    const matching = await db.rpc("legal_version_matches_document", { p_document: doc.id, p_version: latest.id });
    if (matching.error || matching.data !== true) throw new Error("Published legal metadata changed");
  }
  return findMissingLegalActions({ memberships: memberships.data ?? [], isAdmin: Boolean(admin.data),
    documents: applicableDocs as Parameters<typeof findMissingLegalActions>[0]["documents"],
    versions: versions.data ?? [], states: states.data ?? [] });
}
