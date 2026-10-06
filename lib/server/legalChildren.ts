import type { SupabaseClient } from "@supabase/supabase-js";

export async function legalChildren(db: SupabaseClient, actorId: string) {
  const [links, parentMemberships, assertions] = await Promise.all([
    db.from("player_guardians").select("player_id,can_view,can_edit,relation").eq("guardian_user_id", actorId),
    db.from("club_members").select("club_id").eq("user_id", actorId).eq("role", "parent").eq("is_active", true),
    db.from("legal_representative_assertions").select("child_id,club_id,status").eq("guardian_id", actorId),
  ]);
  for (const result of [links, parentMemberships, assertions]) if (result.error) throw result.error;
  const visibleLinks = (links.data ?? []).filter((link) => link.can_view !== false);
  const ids = [...new Set(visibleLinks.map((link) => link.player_id))];
  const clubIds = [...new Set((parentMemberships.data ?? []).map((row) => row.club_id))];
  if (!ids.length || !clubIds.length) return [];
  const memberships = await db.from("club_members").select("user_id,club_id,player_consent_status").in("user_id", ids)
    .eq("role", "player").eq("is_active", true);
  if (memberships.error) throw memberships.error;
  const allClubIds = [...new Set((memberships.data ?? []).map((row) => row.club_id))];
  const [profiles, clubs, states] = await Promise.all([
    db.from("profiles").select("id,first_name,last_name").in("id", ids),
    db.from("clubs").select("id,name").in("id", allClubIds),
    db.from("legal_current_state").select("document_id,beneficiary_id,club_scope,version_id,decision,conflict")
      .in("beneficiary_id", ids).in("club_scope", clubIds),
  ]);
  for (const result of [memberships, profiles, clubs, states]) if (result.error) throw result.error;
  return (memberships.data ?? []).filter((row) => clubIds.includes(row.club_id)).map((membership) => {
    const link = visibleLinks.find((row) => row.player_id === membership.user_id)!;
    const assertion = (assertions.data ?? []).find((row) => row.child_id === membership.user_id && row.club_id === membership.club_id);
    const profile = (profiles.data ?? []).find((row) => row.id === membership.user_id);
    const editable = link.can_edit === true && assertion?.status !== "revoked";
    const verified = editable && assertion?.status === "verified";
    return { child_id: membership.user_id, club_id: membership.club_id,
      child_name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || null,
      club_name: (clubs.data ?? []).find((row) => row.id === membership.club_id)?.name ?? null,
      can_authorize: editable && (verified || ["father", "mother", "legal_guardian"].includes(link.relation)),
      other_clubs_pending: (memberships.data ?? []).filter((row) => row.user_id === membership.user_id
        && !clubIds.includes(row.club_id) && !["adult", "granted"].includes(row.player_consent_status))
        .map((row) => (clubs.data ?? []).find((club) => club.id === row.club_id)?.name ?? "un autre club"),
      representation_verified: verified, consent_status: membership.player_consent_status,
      states: (states.data ?? []).filter((row) => row.beneficiary_id === membership.user_id && row.club_scope === membership.club_id),
    };
  });
}
