import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";

export async function POST(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const input = await req.json();
    const documentId = String(input.document_id ?? ""); const beneficiaryId = String(input.beneficiary_id ?? actor.id);
    const role = String(input.role ?? ""); const locale = String(input.locale ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(documentId) || !/^[0-9a-f-]{36}$/i.test(beneficiaryId) || !["player","parent","coach","manager","admin"].includes(role)
      || !["fr","en","de","it"].includes(locale)) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: legalNoStore });
    const presented = await db.rpc("present_legal_document", { p_document: documentId, p_actor: actor.id, p_beneficiary: beneficiaryId,
      p_role: role, p_locale: locale });
    if (presented.error) return NextResponse.json({ error: presented.error.message }, { status: 409, headers: legalNoStore });
    const row = await db.from("legal_presentations").select("id,rendered_snapshot,expires_at").eq("id", presented.data).single();
    if (row.error) throw row.error;
    return NextResponse.json({ presentation: row.data }, { headers: legalNoStore });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable" }, { status: 503, headers: legalNoStore }); }
}
