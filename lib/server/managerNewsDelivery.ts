import type { SupabaseClient } from "@supabase/supabase-js";

/** Only an explicit provider rejection is safe to retry automatically. */
export class RejectedNewsEmail extends Error {}

export async function deliverManagerNewsEmails(args: {
  db: SupabaseClient; actorId: string; clubId: string; newsId: string;
  recipients: Array<{ user_id: string; full_name: string; email: string | null }>;
  send: (recipient: { user_id: string; full_name: string; email: string }) => Promise<void>;
}) {
  let sent = 0, failed = 0, uncertain = 0, alreadySent = 0;
  let lastError: string | null = null;
  for (const recipient of args.recipients) {
    if (!recipient.email) continue;
    const scope = { p_actor: args.actorId, p_club: args.clubId, p_news: args.newsId, p_recipient: recipient.user_id };
    const claim = await args.db.rpc("claim_manager_news_email_v1", { ...scope, p_email: recipient.email });
    if (claim.error) { failed++; lastError = claim.error.message; continue; }
    const reservation = claim.data as { status: string; attempt_id?: string } | null;
    if (reservation?.status === "sent" || reservation?.status === "legacy_sent") { alreadySent++; continue; }
    if (reservation?.status !== "claimed" || !reservation.attempt_id) { uncertain++; continue; }
    let status: "sent" | "failed" | "uncertain" = "sent";
    let errorMessage: string | null = null;
    try { await args.send({ ...recipient, email: recipient.email }); }
    catch (error) {
      status = error instanceof RejectedNewsEmail ? "failed" : "uncertain";
      errorMessage = error instanceof Error ? error.message : "Envoi non confirmé";
    }
    const finish = await args.db.rpc("finish_manager_news_email_v1", {
      ...scope, p_attempt: reservation.attempt_id, p_status: status, p_error: errorMessage,
    });
    // A failed receipt must leave the reservation in place, never trigger a duplicate.
    if (finish.error) { uncertain++; lastError = finish.error.message; }
    else if (status === "sent") sent++;
    else if (status === "failed") { failed++; lastError = errorMessage; }
    else { uncertain++; lastError = errorMessage; }
  }
  return { email_sent_count: sent, email_already_sent_count: alreadySent, email_failed_count: failed,
    email_uncertain_count: uncertain, email_last_error: lastError, complete: failed === 0 && uncertain === 0 };
}
