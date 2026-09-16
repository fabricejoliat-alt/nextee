import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
};

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string; categoryId: string }> }
) {
  try {
    const { groupId, categoryId } = await context.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: auth } = await db.auth.getUser(token);
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: group, error: groupError } = await db.from("coach_groups").select("club_id").eq("id", groupId).maybeSingle();
    if (groupError) throw groupError;
    if (!group) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 });

    const [{ data: admin }, { data: manager }] = await Promise.all([
      db.from("app_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle(),
      db.from("club_members").select("id").eq("club_id", group.club_id).eq("user_id", auth.user.id).eq("role", "manager").eq("is_active", true).maybeSingle(),
    ]);
    if (!admin && !manager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { error } = await db.from("coach_group_categories").delete().eq("id", categoryId).eq("group_id", groupId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
