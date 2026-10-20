import { legalDb } from "@/lib/server/legalAccess";
import { deletionHeaders, publicDeletionStatus, receiptHash, validReceipt } from "@/lib/server/accountDeletion";

// The capability is sent in a POST body, never a URL, referrer or access log.
export async function POST(req: Request) {
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: deletionHeaders });
  try {
    const input = await req.json();
    if (!validReceipt(input.receipt)) return reply({ error: "NOT_FOUND" }, 404);
    const result = await legalDb().from("account_deletion_requests").select("id,status,requested_at,due_at,completed_at")
      .eq("receipt_hash", receiptHash(input.receipt)).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return reply({ error: "NOT_FOUND" }, 404);
    const expiredAt = result.data.status === "completed" ? result.data.completed_at
      : result.data.status === "cancelled" ? result.data.requested_at : null;
    if (expiredAt && Date.parse(expiredAt) < Date.now() - 90 * 86400000) return reply({ error: "NOT_FOUND" }, 404);
    return reply({ request: publicDeletionStatus(result.data) });
  } catch { return reply({ error: "UNAVAILABLE" }, 503); }
}
