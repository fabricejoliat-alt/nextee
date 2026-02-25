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
    const ids = filtered.map((p: any) => p.id);

    // Auth emails (admin listUsers is paginated; for MVP we fetch first pages only if needed)
    // We'll fetch up to 1000 users by paging.
    const authEmailById = new Map<string, string>();
    let page = 1;
    const perPage = 1000;

    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      for (const u of data.users) {
        if (ids.includes(u.id)) authEmailById.set(u.id, u.email ?? "");
      }

      if (data.users.length < perPage) break;
      page += 1;
      if (page > 10) break; // garde-fou MVP
    }

    const out = filtered.map((p: any) => ({
      id: p.id,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      username: p.username ?? null,
      role: p.app_role ?? "player",
      email: authEmailById.get(p.id) ?? "",
    }));

    return NextResponse.json({ users: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
