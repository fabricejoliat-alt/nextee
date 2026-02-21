import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Server misconfigured: missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 1) ✅ Lire la session depuis les COOKIES (pas besoin de Bearer)
    let res = NextResponse.next();
    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        get(name) {
          return req.cookies.get(name)?.value;
        },
        set(name, value, options) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          res.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    });

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = userData.user.id;

    // 2) ✅ Garder ton admin client pour vérifier les rôles (bypass RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (adminErr) {
      return NextResponse.json(
        { error: adminErr.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const headers = { "Cache-Control": "no-store" as const };

    if (adminRow) return NextResponse.json({ redirectTo: "/admin" }, { headers });

    const { data: membership, error: memErr } = await supabaseAdmin
      .from("club_members")
      .select("club_id, role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memErr) {
      return NextResponse.json(
        { error: memErr.message },
        { status: 400, headers }
      );
    }

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