import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { organizationActor, organizationReply, organizationFailure } from "@/lib/server/organizationAccess";
export async function GET(req: Request) {
  try {
    const access = await organizationActor(req, undefined, true);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const [references, matches, clubs, roster] = await Promise.all([
      access.db.from("external_club_references").select("*").order("name"),
      access.db.from("organization_identity_matches").select("*,player:profiles!organization_identity_matches_player_id_fkey(id,first_name,last_name,username),organization:organizations(id,name)").order("created_at", { ascending: false }).limit(100),
      access.db.from("organizations").select("id,name").eq("org_type", "club").eq("is_active", true).order("name"),
      access.db.from("academy_roster_entries").select("id,player_id,academy_id,external_club_reference_id,player:profiles!academy_roster_entries_player_id_fkey(id,first_name,last_name)").eq("origin_type", "external_club"),
    ]);
    for (const result of [references, matches, clubs, roster]) if (result.error) throw result.error;
    return organizationReply({ references: references.data, matches: matches.data, clubs: clubs.data, proposals: roster.data });
  } catch (error) { return organizationFailure(error); }
}
export const POST = withAdminMutationAudit(async function POST(req: Request) {
  try {
    const access = await organizationActor(req, undefined, true);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const input = await req.json(); let rpc; let params;
    if (input.action === "review" && typeof input.approve === "boolean") {
      rpc = "review_organization_identity_checked";
      params = { p_actor: access.actor.id, p_match: input.match_id, p_approve: input.approve, p_evidence: input.evidence };
    } else if (input.action === "claim") {
      rpc = "claim_external_club_checked";
      params = { p_actor: access.actor.id, p_reference: input.reference_id, p_club: input.club_id };
    } else if (input.action === "affiliate") {
      rpc = "confirm_external_affiliation_checked";
      params = { p_actor: access.actor.id, p_reference: input.reference_id, p_player: input.player_id, p_club: input.club_id, p_reason: input.evidence };
    } else return organizationReply({ error: "organization.invalidInput" }, 400);
    const result = await access.db.rpc(rpc, params);
    if (result.error) throw result.error;
    return organizationReply({ ok: true });
  } catch (error) { return organizationFailure(error); }
});
