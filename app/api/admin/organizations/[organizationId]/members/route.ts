import { organizationActor, organizationReply, organizationFailure } from "@/lib/server/organizationAccess";
type Context = { params: Promise<{ organizationId: string }> };
export async function POST(req: Request, context: Context) {
  try {
    const { organizationId } = await context.params;
    const access = await organizationActor(req, organizationId, true);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const input = await req.json();
    if (typeof input.expected_active !== "boolean") return organizationReply({ error: "organization.invalidInput" }, 400);
    const result = await access.db.rpc("set_organization_manager_checked", {
      p_actor: access.actor.id, p_org: organizationId, p_member: input.member_id,
      p_action: input.action, p_expected_active: input.expected_active,
    });
    if (result.error) throw result.error;
    return organizationReply({ ok: true });
  } catch (error) { return organizationFailure(error); }
}
