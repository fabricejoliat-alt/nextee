import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { loadLegalGateStatus } from "@/lib/server/legalRequirements";
import { loadLegalOrganizationAccessSummary } from "@/lib/server/organizationSummary";
export async function GET(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const [all, organizations] = await Promise.all([
      loadLegalGateStatus(db, actor.id),
      loadLegalOrganizationAccessSummary(db, actor.id),
    ]);
    return NextResponse.json({ missing: all.missing, organization_missing: all.missing.filter(row => row.club_id !== null), enforcement_enabled: all.enabled, organizations }, { headers: legalNoStore });
  } catch { return NextResponse.json({ error: "Legal status unavailable" }, { status: 503, headers: legalNoStore }); }
}
