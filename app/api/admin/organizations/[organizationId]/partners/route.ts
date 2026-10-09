import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { organizationActor, organizationReply, organizationFailure } from "@/lib/server/organizationAccess";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const access = await organizationActor(req, undefined, true);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const { organizationId } = await ctx.params;
    const [partners, clubs, history, documents] = await Promise.all([
      access.db.from("organization_relationships").select("*").eq("source_organization_id", organizationId).order("created_at"),
      access.db.from("organizations").select("id,name,org_type,is_active").eq("org_type", "club").order("name"),
      access.db.from("organization_audit_events").select("id,object_type,action,previous_state,next_state,created_at")
        .eq("organization_id", organizationId).eq("object_type", "organization_relationships").order("created_at", { ascending: false }).limit(50),
      access.db.from("legal_documents").select("id,kind,active,purpose_key").eq("club_id", organizationId),
    ]);
    for (const r of [partners, clubs, history, documents]) if (r.error) throw r.error;
    const purposes=["service.parent_authorization","coaching.rewrite","coaching.ai"];
    const required=(documents.data??[]).filter(doc=>purposes.includes(doc.purpose_key));
    const ids=required.map(doc=>doc.id);
    const versions=ids.length?await access.db.from("legal_versions").select("id,document_id,version_number").in("document_id",ids).order("version_number",{ascending:false}):{data:[],error:null};
    if(versions.error)throw versions.error;
    let active=0,published=0;
    for(const purpose of purposes){const doc=required.find(doc=>doc.purpose_key===purpose);if(!doc)continue;
      const version=versions.data?.find(row=>row.document_id===doc.id);if(!version)continue;
      const match=await access.db.rpc("legal_version_matches_document",{p_document:doc.id,p_version:version.id});
      if(match.error)throw match.error;if(match.data===true){published++;if(doc.active)active++;}
    }
    return organizationReply({ readiness:{required:3,prepared:new Set(required.map(doc=>doc.purpose_key)).size,published,active}, partners: partners.data, clubs: clubs.data, history: history.data, documents: documents.data });
  } catch (error) { return organizationFailure(error); }
}
export const POST = withAdminMutationAudit(async function POST(req: Request, ctx: Context) {
  try {
    const access = await organizationActor(req, undefined, true);
    if (!access) return organizationReply({ error: "Forbidden" }, 403);
    const { organizationId } = await ctx.params, input = await req.json();
    if (typeof input.discovery !== "boolean" || typeof input.requests !== "boolean" || !Number.isInteger(input.expected_revision))
      return organizationReply({ error: "organization.invalidInput" }, 400);
    const result = await access.db.rpc("set_academy_partnership_checked", { p_actor: access.actor.id, p_academy: organizationId,
      p_club: input.club_id, p_status: input.status, p_discovery: input.discovery, p_requests: input.requests, p_expected_revision: input.expected_revision });
    if (result.error) throw result.error;
    return organizationReply({ id: result.data });
  } catch (error) { return organizationFailure(error); }
});
