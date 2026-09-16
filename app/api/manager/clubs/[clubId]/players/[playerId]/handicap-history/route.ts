import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function database() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export async function GET(req: NextRequest, context: { params: Promise<{ clubId: string; playerId: string }> }) {
  try {
    const { clubId, playerId } = await context.params;
    const db = database();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const caller = await db.auth.getUser(accessToken);
    if (caller.error || !caller.data.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = caller.data.user.id;
    const [admin, manager, playerMembership] = await Promise.all([
      db.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
      db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", callerId).eq("role", "manager").eq("is_active", true).maybeSingle(),
      db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", playerId).eq("role", "player").maybeSingle(),
    ]);

    if (!admin.data && !manager.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (playerMembership.error || !playerMembership.data) return NextResponse.json({ error: "Junior introuvable" }, { status: 404 });

    const [profile, history] = await Promise.all([
      db.from("profiles").select("handicap").eq("id", playerId).maybeSingle(),
      db.from("player_handicap_history")
        .select("id,effective_date,value,note,source,created_at,updated_at")
        .eq("user_id", playerId)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

    if (profile.error) return NextResponse.json({ error: profile.error.message }, { status: 400 });
    if (history.error) return NextResponse.json({ error: history.error.message }, { status: 400 });

    return NextResponse.json({
      current_handicap: profile.data?.handicap == null ? null : Number(profile.data.handicap),
      entries: (history.data ?? []).map((entry) => ({ ...entry, value: Number(entry.value) })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
