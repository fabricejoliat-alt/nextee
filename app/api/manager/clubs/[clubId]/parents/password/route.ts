import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireManagerClub } from "@/lib/server/managerAccess";
import { protectedParentAccounts } from "@/lib/server/parentCredentialAccess";

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const { clubId } = await ctx.params;
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const actor = await requireManagerClub(req, db, clubId);
    if (!actor.ok) return reply({ error: actor.error }, actor.status);
    const body = await req.json().catch(() => null);
    if (typeof body?.member_id !== "string" || !body.member_id) return reply({ error: "invalid_parent" }, 400);
    if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
      return reply({ error: "invalid_password" }, 400);
    }
    // Derive the Auth target from this club's parent membership, never a client user_id.
    const member = await db.from("club_members").select("user_id,is_active")
      .eq("id", body.member_id).eq("club_id", clubId).eq("role", "parent").maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) return reply({ error: "parent_not_found" }, 404);
    if (!actor.isSuperadmin) {
      if (!member.data.is_active) return reply({ error: "parent_password_protected" }, 403);
      const protectedAccounts = await protectedParentAccounts(db, [member.data.user_id]);
      if (protectedAccounts.credentials.has(member.data.user_id)) return reply({ error: "parent_password_protected" }, 403);
    }
    const result = await db.auth.admin.updateUserById(member.data.user_id, { password: body.password });
    if (result.error) {
      const code = result.error.code;
      if (code === "weak_password" || code === "same_password") return reply({ error: code }, 400);
      return reply({ error: "parent_password_failed" }, 503);
    }
    return reply({ ok: true });
  } catch {
    return reply({ error: "parent_password_failed" }, 503);
  }
}
