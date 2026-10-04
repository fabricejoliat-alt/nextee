import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";

export async function POST(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const input = await req.json();
    if (!["accepted","acknowledged","authorized","consented","refused","withdrawn"].includes(input.decision)
      || !/^[0-9a-f-]{36}$/i.test(String(input.presentation_id ?? ""))
      || !/^[0-9a-f-]{36}$/i.test(String(input.idempotency_key ?? ""))) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: legalNoStore });
    const result = await db.rpc("decide_legal_document", { p_presentation: input.presentation_id, p_actor: actor.id,
      p_decision: input.decision, p_key: input.idempotency_key, p_parent_code: String(input.parent_code ?? "") });
    if (result.error) return NextResponse.json({ error: result.error.message, code: "LEGAL_RECHECK_REQUIRED" }, { status: 409, headers: legalNoStore });
    if (!result.data) return NextResponse.json({ error: "Invalid confirmation" }, { status: 400, headers: legalNoStore });
    return NextResponse.json({ decision_id: result.data }, { headers: legalNoStore });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable" }, { status: 503, headers: legalNoStore }); }
}
