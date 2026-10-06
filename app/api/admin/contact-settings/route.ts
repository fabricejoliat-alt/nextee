import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });

export async function GET(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const result = await db.from("platform_contact_settings").select("contact_email,updated_at").eq("singleton", true).single();
    if (result.error) throw result.error;
    return reply(result.data);
  } catch { return reply({ error: "Paramètre indisponible. Appliquez la migration 20261106." }, 503); }
}

export async function PUT(req: Request) {
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
  } catch { return reply({ error: "Enregistrement impossible." }, 503); }
}
