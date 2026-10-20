import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const deletionHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };
export const receiptHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const validReceipt = (token: unknown): token is string => typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
export const publicDeletionStatus = (row: Record<string, unknown>) => ({
  id: row.id, status: row.status, requested_at: row.requested_at, due_at: row.due_at, completed_at: row.completed_at,
});

/** Retries are safe: the database snapshots files before erasure and records each removal.
 * A Storage/network failure must never produce a success confirmation. */
export async function executeAccountDeletion(db: SupabaseClient, requestId: string, adminId: string) {
  const erased = await db.rpc("erase_account_data", { p_request: requestId, p_admin: adminId });
  if (erased.error) throw new Error(erased.error.message);
  const request = await db.from("account_deletion_requests").select("files_ready_after").eq("id", requestId).single();
  if (request.error) throw new Error(request.error.message);
  // Bounded work per invocation; an Admin can resume without repeating removed files.
  for (let batch = 0; batch < 10; batch++) {
    const files = await db.from("account_deletion_files").select("bucket_id,object_path")
      .eq("request_id", requestId).is("removed_at", null).limit(100);
    if (files.error) throw new Error(files.error.message);
    if (!files.data?.length) {
      if (request.data?.files_ready_after && Date.parse(request.data.files_ready_after) > Date.now()) return { completed: false };
      const done = await db.rpc("finish_account_deletion", { p_request: requestId, p_admin: adminId });
      if (done.error) throw new Error(done.error.message);
      return { completed: true };
    }
    const buckets = new Set(files.data.map((file) => file.bucket_id));
    for (const bucket of buckets) {
      const paths = files.data.filter((file) => file.bucket_id === bucket).map((file) => file.object_path);
      const removed = await db.storage.from(bucket).remove(paths);
      if (removed.error) throw new Error(`Storage: ${removed.error.message}`);
      const saved = await db.from("account_deletion_files").update({ removed_at: new Date().toISOString() })
        .eq("request_id", requestId).eq("bucket_id", bucket).in("object_path", paths);
      if (saved.error) throw new Error(saved.error.message);
    }
  }
  return { completed: false };
}

export async function sendDeletionConfirmation(db: SupabaseClient, id: string, transport: typeof fetch = fetch) {
  const found = await db.from("account_deletion_requests").select("id,status,contact_email,confirmation_sent_at,locale")
    .eq("id", id).single();
  if (found.error) throw new Error(found.error.message);
  const row = found.data;
  if (row.status !== "completed") throw new Error("Deletion not completed");
  if (!row.contact_email || row.confirmation_sent_at) return;
  if (!process.env.BREVO_API_KEY) throw new Error("Confirmation mail is not configured");
  const copy = {
    fr: ["Votre compte ActiviTee a été supprimé", "La suppression de votre compte ActiviTee et de ses données personnelles dans le service est terminée. Les copies déjà reçues par des destinataires ne peuvent pas être rappelées. Votre reçu de suivi reste consultable pendant 90 jours."],
    en: ["Your ActiviTee account has been deleted", "Deletion of your ActiviTee account and its personal data in the service is complete. Copies already received by recipients cannot be recalled. Your tracking receipt remains available for 90 days."],
    de: ["Dein ActiviTee-Konto wurde gelöscht", "Dein ActiviTee-Konto und seine personenbezogenen Daten im Dienst wurden gelöscht. Bereits empfangene Kopien können nicht zurückgerufen werden. Dein Statusbeleg bleibt 90 Tage verfügbar."],
    it: ["Il tuo account ActiviTee è stato eliminato", "L’eliminazione del tuo account ActiviTee e dei suoi dati personali nel servizio è completata. Le copie già ricevute dai destinatari non possono essere ritirate. La ricevuta resta disponibile per 90 giorni."],
  }[row.locale as "fr" | "en" | "de" | "it"];
  const sender = process.env.LEGAL_MAIL_FROM ?? process.env.MAIL_FROM ?? "noreply@activitee.golf";
  const address = sender.match(/<([^>]+)>/)?.[1] ?? sender;
  const response = await transport("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: { name: "ActiviTee", email: address }, to: [{ email: row.contact_email }],
      subject: copy[0], textContent: copy[1] }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Confirmation delivery failed");
  const saved = await db.from("account_deletion_requests").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", id);
  if (saved.error) throw new Error(saved.error.message);
}
