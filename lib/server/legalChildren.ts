import type { SupabaseClient } from "@supabase/supabase-js";

export async function legalChildren(db: SupabaseClient, actorId: string) {
  const scopes = await db.from("player_guardian_scopes").select("organization_id,player_id,status,can_view,can_edit")
    .eq("guardian_user_id", actorId).in("status", ["pending", "active"]).eq("can_view", true);
  if (scopes.error) throw scopes.error;
  const ids = [...new Set((scopes.data ?? []).map(row => row.player_id))];
  const orgIds = [...new Set((scopes.data ?? []).map(row => row.organization_id))];
  if (!ids.length || !orgIds.length) return [];
  const [links, parentMemberships, memberships, assertions, profiles, organizations, states, roster] = await Promise.all([
    db.from("player_guardians").select("player_id,relation").eq("guardian_user_id", actorId).in("player_id", ids),
    db.from("organization_members").select("organization_id").eq("user_id", actorId).eq("role", "parent").eq("is_active", true),
    db.from("organization_members").select("user_id,organization_id,player_consent_status").in("user_id", ids).in("organization_id", orgIds).eq("role", "player").eq("is_active", true),
    db.from("legal_representative_assertions").select("child_id,club_id,status").eq("guardian_id", actorId),
    db.from("profiles").select("id,first_name,last_name").in("id", ids),
    db.from("organizations").select("id,name,org_type").in("id", orgIds),
    db.from("legal_current_state").select("document_id,beneficiary_id,club_scope,version_id,decision,conflict").in("beneficiary_id", ids).in("club_scope", orgIds),
    db.from("academy_roster_entries").select("academy_id,player_id,status,origin_type,source_approved_at").in("academy_id", orgIds).in("player_id", ids),
  ]);
  for (const result of [links, parentMemberships, memberships, assertions, profiles, organizations, states, roster]) if (result.error) throw result.error;
  return (scopes.data ?? []).flatMap(scope => {
    const membership = (memberships.data ?? []).find(row => row.user_id === scope.player_id && row.organization_id === scope.organization_id);
    if (!membership || !(parentMemberships.data ?? []).some(row => row.organization_id === scope.organization_id)) return [];
    const link = (links.data ?? []).find(row => row.player_id === scope.player_id);
    const assertion = (assertions.data ?? []).find(row => row.child_id === scope.player_id && row.club_id === scope.organization_id);
    const profile = (profiles.data ?? []).find(row => row.id === scope.player_id);
    const org = (organizations.data ?? []).find(row => row.id === scope.organization_id);
    const entry = (roster.data ?? []).find(row => row.player_id === scope.player_id && row.academy_id === scope.organization_id);
    const rosterAllows = !entry || (entry.status!=='ended' && (entry.origin_type !== 'activitee_club' || entry.source_approved_at));
    const editable = scope.can_edit && assertion?.status !== "revoked" && Boolean(rosterAllows);
    const verified = editable && assertion?.status === "verified";
    return [{ child_id: scope.player_id, club_id: scope.organization_id, organization_id: scope.organization_id,
      child_name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || null,
      club_name: org?.name ?? null, organization_name: org?.name ?? null, org_type: org?.org_type ?? null,
      can_authorize: editable && (verified || ["father","mother","legal_guardian"].includes(link?.relation ?? "")),
      other_clubs_pending: [], representation_verified: verified, consent_status: membership.player_consent_status,
      states: (states.data ?? []).filter(row => row.beneficiary_id === scope.player_id && row.club_scope === scope.organization_id) }];
  });
}
