import { organizationActor, organizationReply, organizationFailure } from "@/lib/server/organizationAccess";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const { organizationId } = await ctx.params, access = await organizationActor(req, organizationId);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const organization = await access.db.from("organizations").select("id,name,org_type").eq("id", organizationId).single();
    if (organization.error) throw organization.error;
    const [roster, partners, requests, groups, seasons] = await Promise.all([
      access.db.from("academy_roster_entries").select("*,player:profiles!academy_roster_entries_player_id_fkey(id,first_name,last_name),origin:organizations!academy_roster_entries_origin_organization_id_fkey(id,name),external:external_club_references(id,name)")
        .eq("academy_id", organizationId).order("created_at", { ascending: false }),
      access.db.from("organization_relationships").select("*,club:organizations!organization_relationships_target_organization_id_fkey(id,name),academy:organizations!organization_relationships_source_organization_id_fkey(id,name)")
        .or(`source_organization_id.eq.${organizationId},target_organization_id.eq.${organizationId}`).order("created_at"),
      access.db.from("academy_roster_entries").select("*,player:profiles!academy_roster_entries_player_id_fkey(id,first_name,last_name),academy:organizations!academy_roster_entries_academy_id_fkey(id,name)")
        .eq("origin_organization_id", organizationId).eq("status", "pending").is("source_approved_at", null).order("created_at"),
      access.db.from("coach_groups").select("id,name,club_season_id,players:coach_group_players(player_user_id)").eq("club_id", organizationId).order("name"),
      access.db.from("club_seasons").select("id,name").eq("club_id", organizationId).order("starts_on", { ascending: false }),
    ]);
    for (const r of [roster, partners, requests, groups, seasons]) if (r.error) throw r.error;
    return organizationReply({ organization: organization.data, roster: roster.data, partners: partners.data, requests: requests.data, groups: groups.data, seasons: seasons.data });
  } catch (error) { return organizationFailure(error); }
}
export async function POST(req: Request, ctx: Context) {
  try {
    const { organizationId } = await ctx.params, access = await organizationActor(req, organizationId);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const input = await req.json(); let rpc; let params;
    if (input.action === "request") {
      rpc = "request_academy_roster_checked";
      params = { p_actor: access.actor.id, p_academy: organizationId, p_player: input.player_id,
        p_origin_type: input.origin_type, p_origin: input.origin_organization_id ?? null, p_external: input.external_club_reference_id ?? null };
    } else {
      const target = await access.db.from("academy_roster_entries").select("academy_id,origin_organization_id").eq("id", String(input.entry_id ?? "")).single();
      if (target.error) throw target.error;
      if ((input.action === "approve_source" ? target.data.origin_organization_id : target.data.academy_id) !== organizationId)
        return organizationReply({ error: "Forbidden" }, 403);
      if (input.action === "approve_source" && typeof input.approve === "boolean") {
        rpc = "approve_academy_source_checked";
        params = { p_actor: access.actor.id, p_entry: input.entry_id, p_expected_revision: input.expected_revision, p_approve: input.approve };
      } else if (input.action === "status") {
        rpc = "set_academy_roster_status_checked";
        params = { p_actor: access.actor.id, p_entry: input.entry_id, p_status: input.status, p_expected_revision: input.expected_revision };
      } else return organizationReply({ error: "organization.invalidInput" }, 400);
    }
    const result = await access.db.rpc(rpc, params);
    if (result.error) throw result.error;
    return organizationReply({ ok: true, id: result.data });
  } catch (error) { return organizationFailure(error); }
}
