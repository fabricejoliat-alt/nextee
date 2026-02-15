import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (check .env.local and restart dev server)",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = userData.user.id;

    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 400 });

    const headers = { "Cache-Control": "no-store" as const };

    if (adminRow) return NextResponse.json({ redirectTo: "/admin" }, { headers });

    const { data: membership, error: memErr } = await supabaseAdmin
      .from("club_members")
      .select("club_id, role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 400, headers });

    if (!membership) return NextResponse.json({ redirectTo: "/no-access" }, { headers });

    const role = membership.role as "manager" | "coach" | "player";
    if (role === "manager") return NextResponse.json({ redirectTo: "/manager" }, { headers });
    if (role === "coach") return NextResponse.json({ redirectTo: "/coach" }, { headers });
    return NextResponse.json({ redirectTo: "/player" }, { headers });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
