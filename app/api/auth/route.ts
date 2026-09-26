import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { playerConsentAllowsAccess } from "@/lib/playerConsent";
import { loadPlayerActorAuthorization, visibleGuardianLinks } from "@/app/api/player/access";
import { selectPrimaryApplicationRole } from "@/lib/playerAccessPolicy";

export const runtime = "nodejs";

async function resolvePlayerConsentPending(supabaseAdmin: SupabaseClient, userId: string) {
  const membershipsRes = await supabaseAdmin
    .from("club_members")
    .select("player_consent_status")
    .eq("user_id", userId)
    .eq("role", "player")
    .eq("is_active", true);
  if (membershipsRes.error) throw new Error(membershipsRes.error.message);
  return !playerConsentAllowsAccess(
    ((membershipsRes.data ?? []) as Array<{ player_consent_status: string | null }>).map(
      (row) => row.player_consent_status
    )
  );
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
    const res = NextResponse.next();
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

    const actor = await loadPlayerActorAuthorization(supabaseAdmin, userId);
    const role = selectPrimaryApplicationRole(actor.actorRoles);
    if (!role) return NextResponse.json({ redirectTo: "/no-access" }, { headers });

    if (role === "manager") return NextResponse.json({ redirectTo: "/manager" }, { headers });
    if (role === "coach") return NextResponse.json({ redirectTo: "/coach" }, { headers });
    if (role === "parent") {
      if (visibleGuardianLinks(actor.guardianLinks).length === 0) {
        return NextResponse.json({ redirectTo: "/no-access" }, { headers });
      }
      return NextResponse.json({ redirectTo: "/player" }, { headers });
    }
    if (role === "player") {
      const pendingConsent = await resolvePlayerConsentPending(supabaseAdmin, userId);
      if (pendingConsent) return NextResponse.json({ redirectTo: "/player/consent-required" }, { headers });
    }
    return NextResponse.json({ redirectTo: "/player" }, { headers });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
