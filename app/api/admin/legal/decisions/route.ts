import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
export async function GET(req: Request) {
  try {
    const db = legalDb(); const actor = await legalAdmin(req, db);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: legalNoStore });
    const url = new URL(req.url); const documentId = url.searchParams.get("document_id");
    const beneficiaryId = url.searchParams.get("beneficiary_id"); const clubId = url.searchParams.get("club_id");
    const versionId = url.searchParams.get("version_id"); const decision = url.searchParams.get("decision");
    let query = db.from("legal_decisions").select("id,actor_id,beneficiary_id,document_id,version_id,club_id,decision,source,rendered_snapshot,rendered_sha256,authority_snapshot,decided_at")
      .order("decided_at", { ascending: false }).limit(100);
    if (documentId) query = query.eq("document_id", documentId);
    if (beneficiaryId) query = query.eq("beneficiary_id", beneficiaryId);
    if (clubId) query = query.eq("club_id", clubId);
    if (versionId) query = query.eq("version_id", versionId);
    if (decision) query = query.eq("decision", decision);
    const result = await query;
    if (result.error) throw result.error;
    return NextResponse.json({ decisions: result.data }, { headers: legalNoStore });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable" }, { status: 503, headers: legalNoStore }); }
}
