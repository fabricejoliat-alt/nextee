import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrganizationAccessSummary } from "@/lib/organizationPolicy";
export async function loadOrganizationAccessSummary(db: SupabaseClient, actorId: string, playerId?: string) {
  const result = await db.rpc("organization_access_summary_checked", { p_actor: actorId, p_player: playerId ?? null });
  if (result.error) throw result.error;
  return (result.data ?? []) as OrganizationAccessSummary[];
}

// Presentation only: keep the checked access decision, explain its prerequisites.
export async function loadLegalOrganizationAccessSummary(db: SupabaseClient, actorId: string) {
  const rows = await loadOrganizationAccessSummary(db, actorId);
  return Promise.all(rows.map(async row => {
    if (row.accessible || row.reason !== "authorization_required") return row;
    const [authorization, profile, roster] = await Promise.all([
      db.rpc("organization_player_authorized", { p_org: row.organization_id, p_player: row.player_id }),
      db.from("profiles").select("birth_date").eq("id", row.player_id).maybeSingle(),
      db.from("academy_roster_entries").select("status,origin_type,source_approved_at")
        .eq("academy_id", row.organization_id).eq("player_id", row.player_id).maybeSingle(),
    ]);
    if (authorization.error || profile.error || roster.error) return row;
    const birthDate = profile.data?.birth_date;
    const adultDate = new Date(); adultDate.setUTCFullYear(adultDate.getUTCFullYear() - 18);
    const minor = typeof birthDate === "string" && birthDate > adultDate.toISOString().slice(0, 10);
    let reason = row.reason;
    if (roster.data?.status === "suspended") reason = "affiliation_suspended";
    else if (roster.data?.status === "ended") reason = "affiliation_ended";
    else if (authorization.data === false && minor) reason = "parent_authorization_required";
    else if (authorization.data === true && roster.data?.status === "pending") reason = roster.data.origin_type === "activitee_club" && !roster.data.source_approved_at
      ? "source_approval_required" : "affiliation_activation_required";
    return { ...row, reason };
  }));
}
