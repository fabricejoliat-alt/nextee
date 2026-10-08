import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { loadLegalGateStatus } from "@/lib/server/legalRequirements";
import { loadOrganizationAccessSummary } from "@/lib/server/organizationSummary";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
export async function GET(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
    const [all, organizations] = await Promise.all([
      loadLegalGateStatus(db, actor.id, null, true),
      loadOrganizationAccessSummary(db, actor.id),
    ]);
    const organizationId = requestedOrganizationId(req.url);
    const missing = all.missing.filter(row => row.club_id === null || row.club_id === organizationId);
    return NextResponse.json({ missing, organization_missing: all.missing.filter(row => row.club_id !== null), enforcement_enabled: all.enabled, organizations }, { headers: legalNoStore });
  } catch { return NextResponse.json({ error: "Legal status unavailable" }, { status: 503, headers: legalNoStore }); }
}
