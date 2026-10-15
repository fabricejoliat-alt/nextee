import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/app/api/admin/news/_lib";
import { processPlatformNewsPushes } from "@/lib/server/platformNewsNotifications";

export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = createAdminClient();
    const [due, unqueued] = await Promise.all([
      db.from("platform_news").select("id").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()).limit(50),
      // Recover a publication whose request ended between saving and enqueueing.
      db.from("platform_news").select("id").eq("status", "published").is("notification_initialized_at", null).limit(50),
    ]);
    if (due.error || unqueued.error) throw due.error ?? unqueued.error;
    for (const row of [...(due.data ?? []), ...(unqueued.data ?? [])]) {
      const queued = await db.rpc("enqueue_platform_news_notifications", { p_news_id: row.id });
      if (queued.error) throw queued.error;
    }
    return NextResponse.json({ ok: true, ...await processPlatformNewsPushes(db) });
  } catch {
    return NextResponse.json({ error: "Platform news notification dispatch unavailable" }, { status: 503 });
  }
}
