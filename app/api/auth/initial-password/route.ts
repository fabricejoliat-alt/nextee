import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { initialPasswordRequired } from "@/lib/adminSecurity";

export async function POST(req: Request) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    if (!actor) return reply({ error: "security.sessionExpired" }, 401);
    if (!initialPasswordRequired(actor)) return reply({ error: "security.passwordAlreadyChanged" }, 409);
    const body = await req.json();
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 12 || password.length > 128 || password !== body.confirmPassword) return reply({ error: "security.passwordInvalid" }, 400);
    // GoTrue's user endpoint applies password policy and refuses the same password.
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      method: "PUT", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: req.headers.get("authorization")!, "Content-Type": "application/json" },
      body: JSON.stringify({ password }), cache: "no-store",
    });
    if (!response.ok) return reply({ error: "security.passwordRejected" }, 400);
    const saved = await db.auth.admin.updateUserById(actor.id, {
      app_metadata: { ...actor.app_metadata, initial_password_required: false },
    });
    if (saved.error) throw saved.error;
    return reply({ ok: true });
  } catch { return reply({ error: "security.unavailable" }, 503); }
}
