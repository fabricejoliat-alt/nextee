import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });

export async function GET(req: Request) {
  try {
    const db = legalDb(); if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const result = await db.from("legal_current_state")
      .select("document_id,beneficiary_id,club_scope,version_id,decision_id,decision,decided_at,conflict")
      .eq("conflict", true).order("decided_at", { ascending: false }).limit(100);
    if (result.error) throw result.error;
    return reply({ conflicts: result.data });
  } catch { return reply({ error: "Unavailable" }, 503); }
}

export const POST = withAdminMutationAudit(async function POST(req: Request) {
  try {
    const db = legalDb(); const admin = await legalAdmin(req, db);
    if (!admin) return reply({ error: "Forbidden" }, 403);
    const body = await req.json(); const reason = String(body.reason ?? "").trim();
    const documentId = String(body.document_id ?? ""); const beneficiaryId = String(body.beneficiary_id ?? "");
    const club = body.club_scope == null ? null : String(body.club_scope);
    if (!/^[0-9a-f-]{36}$/i.test(documentId) || !/^[0-9a-f-]{36}$/i.test(beneficiaryId)
      || (club && !/^[0-9a-f-]{36}$/i.test(club)) || reason.length < 20) return reply({ error: "Invalid resolution" }, 400);
    const result = await db.rpc("resolve_legal_withdrawal_conflict", {
      p_document: documentId, p_beneficiary: beneficiaryId, p_club: club, p_admin: admin.id, p_reason: reason });
    if (result.error) return reply({ error: result.error.message }, 409);
    return reply({ resolution_id: result.data });
  } catch { return reply({ error: "Unavailable" }, 503); }
});
