import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { loadLegalDocuments } from "@/lib/server/legalDocuments";

export async function GET(req: Request) {
  try {
    const db = legalDb(); const user = await legalActor(req, db);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    return NextResponse.json({ documents: await loadLegalDocuments(db, user.id) }, { headers: legalNoStore });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable" }, { status: 503, headers: legalNoStore }); }
}
