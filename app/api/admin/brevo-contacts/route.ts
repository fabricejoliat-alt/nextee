import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { brevoContactConfig, runBrevoContactSync } from "@/lib/server/brevoContacts";

export const runtime = "nodejs";
export const maxDuration = 120;
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
export async function GET(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const value = Number(new URL(req.url).searchParams.get("page") ?? 0);
    const page = Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100000) : 0;
    const [stats, control, contacts] = await Promise.all([
      db.rpc("brevo_contact_sync_stats"),
      db.from("brevo_contact_sync_control").select("last_started_at,last_finished_at,last_error,lease_until,cooldown_until,target_list_id").eq("singleton", true).single(),
      db.from("brevo_contact_directory").select("email,attributes").order("email").range(page * 50, page * 50 + 49),
    ]);
    if (stats.error || control.error || contacts.error) throw new Error("unavailable");
    return reply({ config: brevoContactConfig(), stats: stats.data, control: control.data, contacts: contacts.data, page });
  } catch { return reply({ error: "Synchronisation indisponible. Vérifiez que la migration Brevo est installée." }, 503); }
}
export const POST = withAdminMutationAudit(async function POST(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    return reply(await runBrevoContactSync(db));
  } catch { return reply({ error: "Synchronisation impossible. Consultez l’état de la connexion et réessayez." }, 503); }
});
