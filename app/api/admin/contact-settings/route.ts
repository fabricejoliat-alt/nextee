import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
function unavailable(cause: unknown, fallback: string) {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  if (code === "PGRST205" || code === "42P01") {
    return reply({ error: "Le paramètre de contact n’est pas encore installé dans cette base. Une migration est nécessaire.", code: "CONTACT_SETTINGS_NOT_INSTALLED" }, 503);
  }
  return reply({ error: fallback }, 503);
}

export async function GET(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const result = await db.from("platform_contact_settings").select("contact_email,updated_at").eq("singleton", true).single();
    if (result.error) throw result.error;
    return reply(result.data);
  } catch (cause) { return unavailable(cause, "Paramètre de contact indisponible."); }
}

export const PUT = withAdminMutationAudit(async function PUT(req: Request) {
  try {
    const db = legalDb(); const admin = await legalAdmin(req, db);
    if (!admin) return reply({ error: "Forbidden" }, 403);
    const body = await req.json();
    const email = String(body.contact_email ?? "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Adresse e-mail invalide." }, 400);
    const result = await db.from("platform_contact_settings").update({ contact_email: email, updated_at: new Date().toISOString(), updated_by: admin.id })
      .eq("singleton", true).select("contact_email,updated_at").single();
    if (result.error) throw result.error;
    return reply(result.data);
  } catch (cause) { return unavailable(cause, "Enregistrement impossible."); }
});
