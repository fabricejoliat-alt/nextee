import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // caller
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;

    // superadmin only
    const { data: adminRow } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (!adminRow) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // superadmins set (to exclude)
    const { data: admins } = await supabaseAdmin.from("app_admins").select("user_id");
    const adminIds = new Set((admins ?? []).map((a: any) => a.user_id));

    // profiles (exclude superadmins)
    const { data: profiles, error: profErr } = await supabaseAdmin
  .from("profiles")
  .select(
    "id, first_name, last_name, username, app_role"
  )
  .order("created_at", { ascending: false });


    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

    const filtered = (profiles ?? []).filter((p: any) => !adminIds.has(p.id));
    const out = filtered.map((p: any) => ({
      id: p.id,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      username: p.username ?? null,
      role: p.app_role ?? "player",
      email: null,
    }));

    return NextResponse.json({ users: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
