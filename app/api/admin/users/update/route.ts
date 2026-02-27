import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const userId = String(body.userId || "").trim();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    const nextRole = typeof body.role === "string" ? body.role.trim().toLowerCase() : "";
    const allowedRoles = new Set(["manager", "coach", "player", "parent", "captain", "staff"]);
    if (nextRole && !allowedRoles.has(nextRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const nextUsername =
      typeof body.username === "string" ? body.username.trim().toLowerCase() : "";

    // Update profile fields
    const profilePatch: any = {
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      username: nextUsername || null,
      app_role: nextRole || null,
    };


    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update(profilePatch)
      .eq("id", userId);

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

    // Update auth email/password/metadata (optional)
    const nextPassword = typeof body.auth_password === "string" ? body.auth_password : "";
    const hasRoleOrUsername = Boolean(nextRole || nextUsername);

    if (nextPassword || hasRoleOrUsername) {
      const patch: any = {};
      if (nextPassword) patch.password = nextPassword;
      if (hasRoleOrUsername) {
        patch.user_metadata = {
          ...(nextUsername ? { username: nextUsername } : {}),
          ...(nextRole ? { role: nextRole } : {}),
        };
      }

      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, patch);
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
