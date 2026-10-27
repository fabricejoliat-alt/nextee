import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireManagerClub } from "@/lib/server/managerAccess";
import { staffContactEmail } from "@/lib/staffProfile";

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const { clubId } = await ctx.params;
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const actor = await requireManagerClub(req, db, clubId);
    if (!actor.ok) return reply({ error: "emailProtected" }, actor.status);
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (typeof body?.member_id !== "string" || !body.member_id || email.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !staffContactEmail(email)) return reply({ error: "emailInvalid" }, 400);
    const member = await db.from("club_members").select("user_id")
      .eq("id", body.member_id).eq("club_id", clubId).eq("role", "coach").eq("is_active", true).maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) return reply({ error: "emailProtected" }, 404);
    const userId = member.data.user_id;
    const [admin, clubManagers, organizationManagers] = await Promise.all([
      db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      db.from("club_members").select("id").eq("user_id", userId).eq("role", "manager").limit(1),
      db.from("organization_members").select("organization_id").eq("user_id", userId).in("role", ["owner", "admin", "manager"]).limit(1),
    ]);
    if (admin.error || clubManagers.error || organizationManagers.error) throw new Error("Credential scope check failed");
    if (admin.data || clubManagers.data?.length || organizationManagers.data?.length) return reply({ error: "emailProtected" }, 403);
    const account = await db.auth.admin.getUserById(userId);
    if (account.error || !account.data.user) throw new Error("Account unavailable");
    // This operation only fills a missing contact address. Existing real addresses
    // remain under the account holder's control, including across organizations.
    if (staffContactEmail(account.data.user.email)) return reply({ error: "emailAlreadySet" }, 409);
    const result = await db.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (result.error) return reply({ error: ["email_exists", "email_already_exists"].includes(result.error.code ?? "") ? "emailInUse" : "emailFailed" }, 400);
    return reply({ ok: true, email });
  } catch { return reply({ error: "emailFailed" }, 503); }
}
