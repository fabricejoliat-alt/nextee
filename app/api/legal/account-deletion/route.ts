import { createClient } from "@supabase/supabase-js";
import { legalActor, legalDb } from "@/lib/server/legalAccess";
import { deletionHeaders, publicDeletionStatus, receiptHash, validReceipt } from "@/lib/server/accountDeletion";

const reply = (body: object, status = 200) => Response.json(body, { status, headers: deletionHeaders });

export async function GET(req: Request) {
  try {
    const db = legalDb(), actor = await legalActor(req, db);
    if (!actor) return reply({ error: "UNAUTHORIZED" }, 401);
    const result = await db.from("account_deletion_requests").select("*").eq("user_id", actor.id)
      .in("status", ["requested", "processing"]).maybeSingle();
    if (result.error) throw result.error;
    return reply({ request: result.data ? publicDeletionStatus(result.data) : null });
  } catch { return reply({ error: "UNAVAILABLE" }, 503); }
}

export async function POST(req: Request) {
  try {
    const db = legalDb(), actor = await legalActor(req, db);
    if (!actor) return reply({ error: "UNAUTHORIZED" }, 401);
    const input = await req.json();
    if (input.confirm !== true || !validReceipt(input.receipt) || typeof input.password !== "string"
      || !input.password || input.password.length > 256 || !actor.email)
      return reply({ error: "CONFIRMATION_REQUIRED" }, 400);
    const attempt = await db.rpc("reserve_account_deletion_attempt", { p_user: actor.id });
    if (attempt.error) throw attempt.error;
    if (!attempt.data) return reply({ error: "RATE_LIMITED" }, 429);
    // Use the verified session identity, never a submitted user ID/email/child selector.
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await auth.auth.signInWithPassword({ email: actor.email, password: input.password });
    if (verified.error || verified.data.user?.id !== actor.id) return reply({ error: "WRONG_PASSWORD" }, 403);
    await auth.auth.signOut({ scope: "local" });
    const email = actor.email_confirmed_at && !/@(noemail\.local|[^@]*\.invalid)$/i.test(actor.email) ? actor.email : null;
    const saved = await db.rpc("request_account_deletion", {
      p_user: actor.id, p_receipt_hash: receiptHash(input.receipt), p_email: email,
      p_locale: ["fr", "en", "de", "it"].includes(input.locale) ? input.locale : "fr",
    });
    if (saved.error) throw saved.error;
    return reply({ request: publicDeletionStatus(saved.data) }, 201);
  } catch { return reply({ error: "UNAVAILABLE" }, 503); }
}

export async function DELETE(req: Request) {
  try {
    const db = legalDb(), actor = await legalActor(req, db);
    if (!actor) return reply({ error: "UNAUTHORIZED" }, 401);
    const cancelled = await db.from("account_deletion_requests").update({ status: "cancelled" })
      .eq("user_id", actor.id).eq("status", "requested").select("id");
    if (cancelled.error) throw cancelled.error;
    if (!cancelled.data?.length) return reply({ error: "ALREADY_PROCESSING" }, 409);
    return reply({ cancelled: true });
  } catch { return reply({ error: "UNAVAILABLE" }, 503); }
}
