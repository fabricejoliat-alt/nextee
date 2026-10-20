import { legalAdmin, legalDb } from "@/lib/server/legalAccess";
import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { deletionHeaders, executeAccountDeletion, sendDeletionConfirmation } from "@/lib/server/accountDeletion";

const reply = (body: object, status = 200) => Response.json(body, { status, headers: deletionHeaders });
export const maxDuration = 300;
export async function GET(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const fields = "id,user_id,status,contact_email,requested_at,due_at,completed_at,confirmation_sent_at,last_error";
    const [active, completed] = await Promise.all([
      db.from("account_deletion_requests").select(fields).in("status", ["requested", "processing"])
        .order("due_at", { ascending: true }).limit(100),
      db.from("account_deletion_requests").select(fields).eq("status", "completed")
        .order("completed_at", { ascending: false }).limit(20),
    ]);
    if (active.error || completed.error) throw active.error ?? completed.error;
    return reply({ requests: [...active.data, ...completed.data] });
  } catch { return reply({ error: "Demandes indisponibles." }, 503); }
}

export const POST = withAdminMutationAudit(async (req: Request) => {
  const db = legalDb();
  const admin = await legalAdmin(req, db);
  if (!admin) return reply({ error: "Forbidden" }, 403);
  const input = await req.json();
  if (!/^[0-9a-f-]{36}$/i.test(input.id ?? "") || input.confirm_request_id !== input.id)
    return reply({ error: "Confirmez la demande sélectionnée." }, 400);
  const row = await db.from("account_deletion_requests").select("status,user_id").eq("id", input.id).single();
  if (row.error) return reply({ error: "Demande introuvable." }, 404);
  try {
    const result = row.data.status === "completed" ? { completed: true }
      : await executeAccountDeletion(db, input.id, admin.id);
    if (!result.completed) return reply({ completed: false, message: "Fichiers en cours de suppression. Reprenez le traitement." });
    try { await sendDeletionConfirmation(db, input.id); }
    catch {
      return reply({ completed: true, mail_pending: true, message: "Compte supprimé. Le reçu confirme la suppression ; le courriel sera réessayé." });
    }
    return reply({ completed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Suppression interrompue";
    await db.from("account_deletion_requests").update({ last_error: message.slice(0, 500) }).eq("id", input.id);
    return reply({ error: message, message: "Traitement incomplet. Aucune confirmation de suppression n’a été envoyée." }, 409);
  }
});
