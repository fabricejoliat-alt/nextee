import type { SupabaseClient } from "@supabase/supabase-js";
import { playerConsentAllowsAccess } from "@/lib/playerConsent";
import { guardianCanEdit, type GuardianAccessLink } from "@/lib/playerAccessPolicy";

export async function pendingEditableParentChildren(db: SupabaseClient, links: GuardianAccessLink[], actorId?: string) {
  const childIds = [...new Set(links.filter(guardianCanEdit).map((link) => link.playerId).filter(Boolean))];
  if (!childIds.length) return [];
  const memberships = await db.from("club_members").select("user_id,club_id,player_consent_status")
    .in("user_id", childIds).eq("role", "player").eq("is_active", true);
  if (memberships.error) throw new Error("Impossible de vérifier les autorisations des enfants.");
  const parentMemberships = actorId ? await db.from("club_members").select("club_id")
    .eq("user_id", actorId).eq("role", "parent").eq("is_active", true) : null;
  if (parentMemberships?.error) throw parentMemberships.error;
  const scopedRights = actorId ? await db.from("player_guardian_scopes").select("organization_id,player_id,can_edit,status").eq("guardian_user_id",actorId).in("status",["pending","active"]).eq("can_edit",true) : null;
  if(scopedRights?.error)throw scopedRights.error;
  const [relationships, assertions] = actorId ? await Promise.all([
    db.from("player_guardians").select("player_id,relation").eq("guardian_user_id", actorId).in("player_id", childIds),
    db.from("legal_representative_assertions").select("child_id,club_id,status").eq("guardian_id", actorId).in("child_id", childIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (relationships.error || assertions.error) throw relationships.error ?? assertions.error;
  const scopedMemberships = (memberships.data ?? []).filter((row) => {
    if (!actorId) return true;
    if(!(scopedRights?.data??[]).some(scope=>scope.player_id===row.user_id&&scope.organization_id===row.club_id))return false;
    if (!(parentMemberships?.data ?? []).some((parent) => parent.club_id === row.club_id)) return false;
    const assertion = (assertions.data ?? []).find((entry) => entry.child_id === row.user_id && entry.club_id === row.club_id);
    return assertion?.status !== "revoked" && (assertion?.status === "verified"
      || (relationships.data ?? []).some((entry) => entry.player_id === row.user_id && ["father", "mother", "legal_guardian"].includes(entry.relation)));
  });
  const clubIds = [...new Set(scopedMemberships.map((row) => row.club_id))];
  const documents = clubIds.length ? await db.from("legal_documents").select("id,club_id")
    .in("club_id", clubIds).eq("active", true).eq("kind", "parent_authorization")
    .eq("purpose_key", "service.parent_authorization") : { data: [], error: null };
  if (documents.error) throw documents.error;
  const documentIds = (documents.data ?? []).map((doc) => doc.id);
  const [versions, states] = documentIds.length ? await Promise.all([
    db.from("legal_versions").select("id,document_id,version_number").in("document_id", documentIds).order("version_number", { ascending: false }),
    db.from("legal_current_state").select("document_id,beneficiary_id,club_scope,version_id,decision,conflict")
      .in("document_id", documentIds).in("beneficiary_id", childIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (versions.error || states.error) throw versions.error ?? states.error;
  const missingVersioned = new Set<string>();
  for (const row of scopedMemberships) {
    if (row.player_consent_status === "adult") continue;
    const docs = (documents.data ?? []).filter((doc) => doc.club_id === row.club_id);
    if (!docs.length) continue;
    if (docs.length !== 1) { missingVersioned.add(row.user_id); continue; }
    const doc = docs[0]; const version = (versions.data ?? []).find((entry) => entry.document_id === doc.id);
    const state = (states.data ?? []).find((entry) => entry.document_id === doc.id
      && entry.beneficiary_id === row.user_id && entry.club_scope === row.club_id);
    if (!version || state?.version_id !== version.id || state.decision !== "authorized" || state.conflict)
      missingVersioned.add(row.user_id);
  }
  const statuses = new Map<string, Array<string | null>>();
  for (const membership of scopedMemberships) {
    const rows = statuses.get(membership.user_id) ?? [];
    rows.push(membership.player_consent_status);
    statuses.set(membership.user_id, rows);
  }
  return childIds.filter((id) => {
    const rows = statuses.get(id);
    return rows ? !playerConsentAllowsAccess(rows) || missingVersioned.has(id) : false;
  });
}
