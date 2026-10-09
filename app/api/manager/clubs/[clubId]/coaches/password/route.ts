import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireManagerClub } from "@/lib/server/managerAccess";

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const { clubId } = await ctx.params;
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const actor = await requireManagerClub(req, db, clubId);
    if (!actor.ok) return reply({ error: actor.error }, actor.status);

    const body = await req.json().catch(() => null);
    if (typeof body?.member_id !== "string" || !body.member_id) return reply({ error: "invalid_coach" }, 400);
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
      return reply({ error: "invalid_password" }, 400);
    }

    // Resolve the Auth account only through an active coach membership in this club.
    const member = await db.from("club_members").select("user_id")
      .eq("id", body.member_id).eq("club_id", clubId).eq("role", "coach").eq("is_active", true).maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) return reply({ error: "coach_not_found" }, 404);
    const userId = member.data.user_id;

    // A club Manager cannot reset a platform or Manager account through its coach role.
    const [admin, clubManagers, organizationManagers] = await Promise.all([
      db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      db.from("club_members").select("id").eq("user_id", userId).eq("role", "manager").limit(1),
      db.from("organization_members").select("id").eq("user_id", userId).in("role", ["owner", "admin", "manager"]).limit(1),
    ]);
    if (admin.error || clubManagers.error || organizationManagers.error) throw new Error("Credential scope check failed");
    if (admin.data || clubManagers.data?.length || organizationManagers.data?.length) {
      return reply({ error: "coach_password_protected" }, 403);
    }

    const result = await db.auth.admin.updateUserById(userId, { password: body.password });
    if (result.error) {
      if (result.error.code === "weak_password" || result.error.code === "same_password") {
        return reply({ error: result.error.code }, 400);
      }
      return reply({ error: "coach_password_failed" }, 503);
    }
    return reply({ ok: true });
  } catch {
    return reply({ error: "coach_password_failed" }, 503);
  }
}
