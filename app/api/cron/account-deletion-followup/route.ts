import { legalDb } from "@/lib/server/legalAccess";
import { deletionHeaders, executeAccountDeletion, sendDeletionConfirmation } from "@/lib/server/accountDeletion";

export const maxDuration = 300;
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: deletionHeaders });
  try {
    const db = legalDb();
    const running = await db.from("account_deletion_requests").select("id,processed_by").eq("status", "processing")
      .lte("files_ready_after", new Date().toISOString()).limit(2);
    if (running.error) throw running.error;
    let failures = 0;
    for (const row of running.data ?? []) {
      try { await executeAccountDeletion(db, row.id, row.processed_by); }
      catch (e) {
        failures++;
        await db.from("account_deletion_requests").update({ last_error: e instanceof Error ? e.message.slice(0, 500) : "Retry failed" }).eq("id", row.id);
      }
    }
    const pending = await db.from("account_deletion_requests").select("id").eq("status", "completed")
      .is("confirmation_sent_at", null).not("contact_email", "is", null).limit(10);
    if (pending.error) throw pending.error;
    for (const row of pending.data ?? []) {
      try { await sendDeletionConfirmation(db, row.id); } catch { failures++; }
    }
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const completed = await db.from("account_deletion_requests").delete().eq("status", "completed").lt("completed_at", cutoff);
    const cancelled = await db.from("account_deletion_requests").delete().eq("status", "cancelled").lt("requested_at", cutoff);
    const attempts = await db.from("account_deletion_attempts").delete().lt("window_start", new Date(Date.now() - 86400000).toISOString());
    if (completed.error || cancelled.error || attempts.error) throw new Error("Retention cleanup failed");
    const overdue = await db.from("account_deletion_requests").select("id", { count: "exact", head: true })
      .in("status", ["requested", "processing"]).lt("due_at", new Date().toISOString());
    if (overdue.error) throw overdue.error;
    return Response.json({ failures, overdue: overdue.count ?? 0 },
      { status: failures || overdue.count ? 503 : 200, headers: deletionHeaders });
  } catch { return Response.json({ error: "Follow-up incomplete" }, { status: 503, headers: deletionHeaders }); }
}
