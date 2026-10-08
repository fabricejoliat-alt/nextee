import type { SupabaseClient } from "@supabase/supabase-js";
import { eligibleLegalRole, findMissingLegalActions, type RequiredLegalDocument } from "@/lib/legalRequirements";

export async function loadLegalGateStatus(db: SupabaseClient, actorId: string, organizationId?: string | null, allOrganizations = false) {
  const control = await db.from("legal_enforcement_control").select("enabled").eq("singleton", true).maybeSingle();
  if (control.error || !control.data) throw new Error("Legal direct-access gate is unavailable");
  if (!control.data.enabled) return { enabled: false, missing: [] };
  const [memberships, admin, docs] = await Promise.all([
    db.from("club_members").select("club_id,role").eq("user_id", actorId).eq("is_active", true),
    db.from("app_admins").select("user_id").eq("user_id", actorId).maybeSingle(),
    db.from("legal_documents").select("id,document_key,kind,scope,club_id,audience_roles,action_kind,required,active,applicability")
      .eq("active", true).eq("required", true),
  ]);
  for (const result of [memberships, admin, docs]) if (result.error) throw new Error(result.error.message);
  const applicableDocs = (docs.data ?? []).filter((doc) =>
    (allOrganizations || doc.scope === "platform" || doc.club_id === organizationId)
    && eligibleLegalRole(doc as RequiredLegalDocument, memberships.data ?? [], Boolean(admin.data)));
  for (const doc of applicableDocs) {
    if (["terms", "privacy", "junior_notice"].includes(doc.kind)
      && (doc.applicability as { rule?: string } | null)?.rule !== "all_members") {
      throw new Error("An active required legal rule is not executable");
    }
  }
  const documentIds = applicableDocs.map((doc) => doc.id);
  if (!documentIds.length) return { enabled: true, missing: [] };
  const [versions, states] = await Promise.all([
    db.from("legal_versions").select("id,document_id,version_number").in("document_id", documentIds),
    db.from("legal_current_state").select("document_id,version_id,club_scope,decision,conflict")
      .eq("beneficiary_id", actorId).in("document_id", documentIds),
  ]);
  if (versions.error || states.error) throw new Error(versions.error?.message ?? states.error?.message);
  await Promise.all(applicableDocs.filter(doc => ["terms", "privacy", "junior_notice"].includes(doc.kind)).map(async doc => {
    const latest = (versions.data ?? []).filter((version) => version.document_id === doc.id)
      .sort((a, b) => b.version_number - a.version_number)[0];
    if (!latest) {
      throw new Error("An active required legal document has no published version");
    }
    // The decision/presentation RPCs already reject changed published metadata.
    // Apply the same invariant before letting an old acceptance unlock business data.
    const matching = await db.rpc("legal_version_matches_document", { p_document: doc.id, p_version: latest.id });
    if (matching.error || matching.data !== true) throw new Error("Published legal metadata changed");
  }));
  const missing = findMissingLegalActions({ memberships: memberships.data ?? [], isAdmin: Boolean(admin.data),
    documents: applicableDocs as Parameters<typeof findMissingLegalActions>[0]["documents"],
    versions: versions.data ?? [], states: states.data ?? [] });
  return { enabled: true, missing };
}

export async function loadMissingLegalActions(db: SupabaseClient, actorId: string) {
  return (await loadLegalGateStatus(db, actorId)).missing;
}
