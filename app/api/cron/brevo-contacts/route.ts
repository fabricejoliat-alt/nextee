import { NextResponse } from "next/server";
import { legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { runBrevoContactSync, secretMatches } from "@/lib/server/brevoContacts";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(req: Request) {
  if (!secretMatches(req.headers.get("authorization"), process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: legalNoStore });
  }
  try { return NextResponse.json(await runBrevoContactSync(legalDb()), { headers: legalNoStore }); }
  catch { return NextResponse.json({ error: "BREVO_SYNC_UNAVAILABLE" }, { status: 503, headers: legalNoStore }); }
}
