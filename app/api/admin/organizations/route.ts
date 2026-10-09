import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { organizationActor, organizationReply, organizationFailure } from "@/lib/server/organizationAccess";

export const POST = withAdminMutationAudit(async function POST(req: Request) {
  try {
    const access = await organizationActor(req, undefined, true);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const input = await req.json();
    const result = await access.db.rpc("create_organization_checked", {
      p_actor: access.actor.id, p_name: String(input.name ?? "").trim(),
      p_slug: String(input.slug ?? "").trim(), p_type: String(input.org_type ?? ""),
    });
    if (result.error) throw result.error;
    return organizationReply({ id: result.data }, 201);
  } catch (error) { return organizationFailure(error); }
});
