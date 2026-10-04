import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { loadMissingLegalActions } from "@/lib/server/legalRequirements";
export async function GET(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    if (process.env.LEGAL_ENFORCEMENT_ENABLED !== "true") {
      return NextResponse.json({ missing: [], enforcement_enabled: false }, { headers: legalNoStore });
    }
    const missing = await loadMissingLegalActions(db, actor.id);
    return NextResponse.json({ missing, enforcement_enabled: true }, { headers: legalNoStore });
  } catch { return NextResponse.json({ error: "Legal status unavailable" }, { status: 503, headers: legalNoStore }); }
}
