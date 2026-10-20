import { createAdminClient } from "@/app/api/player/marketplace/_lib";
import { processMarketplaceMessagePushes } from "@/lib/server/marketplaceMessageNotifications";

export const maxDuration = 60;
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json({ ok: true, ...await processMarketplaceMessagePushes(createAdminClient()) }); }
  catch { return Response.json({ error: "Marketplace notification dispatch unavailable" }, { status: 503 }); }
}
