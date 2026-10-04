import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";

export async function GET(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const params = new URL(req.url).searchParams;
    const beneficiary = params.get("beneficiary_id");
    const club = params.get("club_id");
    if (beneficiary && beneficiary !== actor.id) {
      if (!club || !/^[0-9a-f-]{36}$/i.test(beneficiary) || !/^[0-9a-f-]{36}$/i.test(club)) {
        return NextResponse.json({ error: "Invalid child scope" }, { status: 400, headers: legalNoStore });
      }
      const access = await db.rpc("legal_actor_allowed", { p_actor: actor.id, p_beneficiary: beneficiary,
        p_club: club, p_role: "parent" });
      if (access.error) throw access.error;
      if (!access.data) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: legalNoStore });
    }
    let query = db.from("legal_decisions").select("id,actor_id,beneficiary_id,document_id,version_id,club_id,decision,source,rendered_snapshot,rendered_sha256,authority_snapshot,decided_at")
      .order("decided_at", { ascending: false }).limit(200);
    query = beneficiary && beneficiary !== actor.id
      ? query.eq("beneficiary_id", beneficiary).eq("club_id", club!)
      : query.eq("actor_id", actor.id);
    const decisions = await query;
    if (decisions.error) throw decisions.error;
    return NextResponse.json({ decisions: decisions.data }, { headers: legalNoStore });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable" }, { status: 503, headers: legalNoStore }); }
}
