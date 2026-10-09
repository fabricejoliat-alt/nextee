import { createClient } from "@supabase/supabase-js";
import { readOnceFetch } from "@/lib/readOnceFetch";
import { verifiedAdminAssurance } from "@/lib/server/adminSecurity";

export function legalDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase configuration missing");
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: readOnceFetch } });
}

export async function legalActor(req: Request, db = legalDb()) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const result = await db.auth.getUser(token);
  return result.error ? null : result.data.user;
}

export async function legalAdmin(req: Request, db = legalDb()) {
  const user = await legalActor(req, db);
  if (!user) return null;
  const result = await db.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (result.error || !result.data) return null;
  const token = req.headers.get("authorization")!.replace(/^Bearer\s+/i, "").trim();
  const assurance = await verifiedAdminAssurance(db, token, user.id);
  return assurance.mfa ? user : null;
}

export const legalNoStore = { "Cache-Control": "private, no-store, max-age=0" };
