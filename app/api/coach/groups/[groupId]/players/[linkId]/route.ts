import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasCoachClubPermission } from "@/lib/coachAuthorization";

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ groupId: string; linkId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { groupId, linkId } = await ctx.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const caller = await db.auth.getUser(token);
    if (caller.error || !caller.data.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const group = await db.from("coach_groups").select("id,club_id").eq("id", groupId).maybeSingle();
    if (group.error || !group.data) return NextResponse.json({ error: "Groupe introuvable." }, { status: 404 });
    const allowed = await hasCoachClubPermission(db, caller.data.user.id, String(group.data.club_id), "groups", groupId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await db.from("coach_group_players").delete().eq("id", linkId).eq("group_id", groupId);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Server error" }, { status: 500 });
  }
}
