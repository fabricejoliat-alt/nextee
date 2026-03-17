import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

function computeAge(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

async function resolvePlayerConsentPending(supabaseAdmin: any, userId: string) {
  const [profileRes, membershipsRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("birth_date").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("club_members")
      .select("player_consent_status")
      .eq("user_id", userId)
      .eq("role", "player")
      .eq("is_active", true),
  ]);

  if (profileRes.error) throw new Error(profileRes.error.message);
  if (membershipsRes.error) throw new Error(membershipsRes.error.message);

  const statuses = (membershipsRes.data ?? []).map((row: any) => String(row?.player_consent_status ?? ""));
  if (statuses.includes("pending")) return true;
  if (statuses.includes("granted") || statuses.includes("adult")) return false;
  const age = computeAge((profileRes.data?.birth_date ?? null) as string | null);
  return !(age != null && age >= 18);
}

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

    // 1) ✅ Utiliser en priorité le bearer token si fourni; sinon fallback sur les cookies.
    let res = NextResponse.next();
    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set({ name, value, ...options });
          });
        },
      },
      cookieOptions: {
        path: "/",
        sameSite: "lax",
      },
    });

    const bearerToken = req.headers.get("authorization")?.replace("Bearer ", "").trim() || "";
    let userId = "";

    if (bearerToken) {
      const adminAuthClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });
      const { data: bearerUserData } = await adminAuthClient.auth.getUser(bearerToken);
      userId = bearerUserData.user?.id ?? "";
    }

    if (!userId) {
      const { data: userData } = await supabase.auth.getUser();
      userId = userData.user?.id ?? "";
    }

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

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

    const role = membership.role as "manager" | "coach" | "player" | "parent";
    if (role === "manager") return NextResponse.json({ redirectTo: "/manager" }, { headers });
    if (role === "coach") return NextResponse.json({ redirectTo: "/coach" }, { headers });
    if (role === "parent") {
      const { data: linkRow, error: linkErr } = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", userId)
        .limit(1)
        .maybeSingle();
      if (linkErr) {
        return NextResponse.json(
          { error: linkErr.message },
          { status: 400, headers }
        );
      }
      if (!linkRow?.player_id) return NextResponse.json({ redirectTo: "/no-access" }, { headers });
      return NextResponse.json({ redirectTo: "/player" }, { headers });
    }
    if (role === "player") {
      const pendingConsent = await resolvePlayerConsentPending(supabaseAdmin, userId);
      if (pendingConsent) return NextResponse.json({ redirectTo: "/player/consent-required" }, { headers });
    }
    return NextResponse.json({ redirectTo: "/player" }, { headers });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
