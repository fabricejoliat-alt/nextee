import { organizationActor, organizationReply, organizationFailure } from "@/lib/server/organizationAccess";
export async function GET(req: Request, ctx: { params: Promise<{ organizationId: string }> }) {
  try {
    const { organizationId } = await ctx.params, access = await organizationActor(req, organizationId);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const query = new URL(req.url).searchParams;
    const result = await access.db.rpc("discover_academy_players_checked", {
      p_actor: access.actor.id, p_academy: organizationId, p_club: query.get("club"), p_query: query.get("q"),
    });
    if (result.error) throw result.error;
    return organizationReply({ players: result.data });
  } catch (error) { return organizationFailure(error); }
}
