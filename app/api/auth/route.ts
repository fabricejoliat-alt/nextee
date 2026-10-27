import { initialPasswordRequired } from "@/lib/adminSecurity";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { playerConsentAllowsAccess } from "@/lib/playerConsent";
import { loadPlayerActorAuthorization, visibleGuardianLinks } from "@/app/api/player/access";
import { selectPrimaryApplicationRole } from "@/lib/playerAccessPolicy";
import { pendingEditableParentChildren } from "@/lib/server/parentConsentRequirements";


function resolvePlayerConsentPending(memberships: Array<{ role: string; player_consent_status: string | null }>) {
  return !playerConsentAllowsAccess(
    memberships.filter((row) => row.role === "player").map(
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
    let needsInitialPassword = false;

    if (bearerToken) {
      const adminAuthClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });
      const { data: bearerUserData } = await adminAuthClient.auth.getUser(bearerToken);
      userId = bearerUserData.user?.id ?? "";
      needsInitialPassword = Boolean(bearerUserData.user && initialPasswordRequired(bearerUserData.user));
    }

    if (!userId) {
      const { data: userData } = await supabase.auth.getUser();
      userId = userData.user?.id ?? "";
      needsInitialPassword = Boolean(userData.user && initialPasswordRequired(userData.user));
    }

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (needsInitialPassword) return NextResponse.json(
      { redirectTo: "/change-initial-password" }, { headers: { "Cache-Control": "private, no-store" } });

    // 2) ✅ Garder ton admin client pour vérifier les rôles (bypass RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const [adminResult, membershipsResult] = await Promise.all([
      supabaseAdmin.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("club_members").select("role,player_consent_status").eq("user_id", userId).eq("is_active", true),
    ]);
    const { data: adminRow, error: adminErr } = adminResult;

    if (adminErr) {
      return NextResponse.json(
        { error: adminErr.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const headers = { "Cache-Control": "no-store" as const };

    if (adminRow) return NextResponse.json({ redirectTo: "/admin" }, { headers });

    if (membershipsResult.error) return NextResponse.json(
      { error: membershipsResult.error.message }, { status: 400, headers });
    const memberships = (membershipsResult.data ?? []) as Array<{ role: string; player_consent_status: string | null }>;
    const role = selectPrimaryApplicationRole(memberships.map((row) => row.role));
    if (!role) return NextResponse.json({ redirectTo: "/no-access" }, { headers });

    if (role === "manager") return NextResponse.json({ redirectTo: "/manager" }, { headers });
    if (role === "coach") return NextResponse.json({ redirectTo: "/coach" }, { headers });

    if (role === "parent") {
      const actor = await loadPlayerActorAuthorization(supabaseAdmin, userId);
      const links = visibleGuardianLinks(actor.guardianLinks);
      if (links.length === 0) {
        return NextResponse.json({ redirectTo: "/no-access" }, { headers });
      }
      const pendingChildIds = await pendingEditableParentChildren(supabaseAdmin, links, userId);
      if (pendingChildIds.length) return NextResponse.json({ redirectTo: "/legal/my", parentConsentRequired: true,
        pendingChildIds }, { headers });
      return NextResponse.json({ redirectTo: "/player" }, { headers });
    }
    if (role === "player") {
      const pendingConsent = resolvePlayerConsentPending(memberships);
      if (pendingConsent) return NextResponse.json({ redirectTo: "/legal/my", consentRequired: true }, { headers });
    }
    return NextResponse.json({ redirectTo: "/player" }, { headers });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
