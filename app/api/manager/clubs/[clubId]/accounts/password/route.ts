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
    if (typeof body?.member_id !== "string" || !body.member_id || !["player", "manager"].includes(body.role)) {
      return reply({ error: "invalid_member" }, 400);
    }
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
      return reply({ error: "invalid_password" }, 400);
    }

    // The user id and role must come from the selected club membership, never the request body alone.
    const member = await db.from("club_members").select("user_id")
      .eq("id", body.member_id).eq("club_id", clubId).eq("role", body.role).eq("is_active", true).maybeSingle();
    if (member.error) throw member.error;
    if (!member.data) return reply({ error: "member_not_found" }, 404);
    const userId = member.data.user_id;

    const [admin, clubRoles, organizationRoles] = await Promise.all([
      db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      db.from("club_members").select("club_id,role").eq("user_id", userId).in("role", ["manager", "coach"]),
      db.from("organization_members").select("organization_id,role").eq("user_id", userId).in("role", ["owner", "admin", "manager"]),
    ]);
    if (admin.error || clubRoles.error || organizationRoles.error) throw new Error("Credential scope check failed");
    const protectedClubRole = body.role === "player"
      ? Boolean(clubRoles.data?.length)
      : clubRoles.data?.some((item) => item.role !== "manager" || item.club_id !== clubId);
    const protectedOrganizationRole = body.role === "player"
      ? Boolean(organizationRoles.data?.length)
      : organizationRoles.data?.some((item) => item.role !== "manager" || item.organization_id !== clubId);
    if (admin.data || protectedClubRole || protectedOrganizationRole) {
      return reply({ error: "password_protected" }, 403);
    }

    const result = await db.auth.admin.updateUserById(userId, { password: body.password });
    if (result.error) {
      if (result.error.code === "weak_password" || result.error.code === "same_password") {
        return reply({ error: result.error.code }, 400);
      }
      return reply({ error: "password_failed" }, 503);
    }
    return reply({ ok: true });
  } catch {
    return reply({ error: "password_failed" }, 503);
  }
}
