import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { loadLegalGateStatus } from "@/lib/server/legalRequirements";
export async function GET(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const status = await loadLegalGateStatus(db, actor.id);
    return NextResponse.json({ missing: status.missing, enforcement_enabled: status.enabled }, { headers: legalNoStore });
  } catch { return NextResponse.json({ error: "Legal status unavailable" }, { status: 503, headers: legalNoStore }); }
}
