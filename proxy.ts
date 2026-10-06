import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { playerConsentAllowsAccess } from "@/lib/playerConsent";
import { loadLegalGateStatus } from "@/lib/server/legalRequirements";
import { legalRouteKind } from "@/lib/legalRouteCoverage";

export async function proxy(req: NextRequest) {
  const res = NextResponse.next({
    request: { headers: req.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );

  // ✅ refresh / récupère l'utilisateur si session encore valable
  const { data } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isPlayerPage = path === "/player" || path.startsWith("/player/");
  const isConsentPage = path === "/player/consent-required";
  const isConsentEndpoint = path === "/api/player/consent";
  const requiresPlayerConsent =
    (isPlayerPage && !isConsentPage) ||
    (path.startsWith("/api/player/") && !isConsentEndpoint) ||
    path.startsWith("/api/messages/");

  if (requiresPlayerConsent) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceRoleKey || !supabaseUrl) {
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const bearerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let userId = data.user?.id ?? "";
    if (bearerToken) {
      const { data: bearerData, error: bearerError } = await supabaseAdmin.auth.getUser(bearerToken);
      if (bearerError || !bearerData.user) {
        return NextResponse.json(
          { error: "Invalid token" },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
      }
      userId = bearerData.user.id;
    }

    if (userId) {
      const membershipsRes = await supabaseAdmin
        .from("club_members")
        .select("player_consent_status")
        .eq("user_id", userId)
        .eq("role", "player")
        .eq("is_active", true);

      if (membershipsRes.error) {
        return NextResponse.json(
          { error: "Unable to verify player consent" },
          { status: 503, headers: { "Cache-Control": "no-store" } }
        );
      }

      const playerMemberships = membershipsRes.data ?? [];
      if (
        playerMemberships.length > 0 &&
        !playerConsentAllowsAccess(playerMemberships.map((row) => row.player_consent_status))
      ) {
        if (isPlayerPage) {
          const url = req.nextUrl.clone();
          url.pathname = "/player/consent-required";
          url.search = "";
          return NextResponse.redirect(url);
        }
        return NextResponse.json(
          { error: "Player consent required", code: "PLAYER_CONSENT_REQUIRED" },
          { status: 403, headers: { "Cache-Control": "no-store" } }
        );
      }
    }
  }

  const isProtected =
    path.startsWith("/player") ||
    path.startsWith("/coach") ||
    path.startsWith("/manager") ||
    path.startsWith("/admin");

  const isLogin = path === "/" || path.startsWith("/login");

  // ✅ Protège les zones
  if (isProtected && !data.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  const legalRoute = legalRouteKind(path);
  if (legalRoute) {
    res.headers.set("Cache-Control", "private, no-store");
    const bearerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "Legal gate unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
    const database = createClient(url, key, { auth: { persistSession: false } });
    try {
      const control = await database.from("legal_enforcement_control")
        .select("enabled").eq("singleton", true).maybeSingle();
      if (control.error || !control.data) throw new Error("Legal control unavailable");
      if (control.data.enabled) {
        let actorId = data.user?.id ?? "";
        if (bearerToken) {
          const actor = await database.auth.getUser(bearerToken);
          if (actor.error || !actor.data.user) return NextResponse.json({ error: "Invalid token" },
            { status: 401, headers: { "Cache-Control": "no-store" } });
          actorId = actor.data.user.id;
        }
        if (!actorId) return NextResponse.json({ error: "Unauthorized" },
          { status: 401, headers: { "Cache-Control": "no-store" } });
        const { missing } = await loadLegalGateStatus(database, actorId);
        if (missing.length) {
          if (legalRoute === "page") {
            const destination = req.nextUrl.clone(); destination.pathname = "/legal/my"; destination.search = "";
            const redirect = NextResponse.redirect(destination);
            redirect.headers.set("Cache-Control", "private, no-store");
            return redirect;
          }
          return NextResponse.json({ error: "Legal action required", code: "LEGAL_ACTION_REQUIRED", missing },
            { status: 403, headers: { "Cache-Control": "no-store" } });
        }
      }
    } catch {
      return NextResponse.json({ error: "Legal status unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }

  // ✅ Si déjà loggé et va sur login, redirige vers la bonne zone (rôle)
  if (isLogin && data.user) {
    try {
      // Appel interne à ton endpoint de rôle
      const authRes = await fetch(new URL("/api/auth", req.url), {
        method: "POST",
        headers: {
          // on passe les cookies automatiquement côté edge/proxy
          cookie: req.headers.get("cookie") ?? "",
        },
      });

      const json = await authRes.json().catch(() => ({}));
      const redirectTo = json?.redirectTo;

      if (authRes.ok && typeof redirectTo === "string" && redirectTo.startsWith("/")) {
        const url = req.nextUrl.clone();
        url.pathname = redirectTo;
        url.search = "";
        return NextResponse.redirect(url);
      }
    } catch {
      // fallback silencieux
    }

    const url = req.nextUrl.clone();
    url.pathname = "/player";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/player/:path*",
    "/coach/:path*",
    "/manager/:path*",
    "/admin/:path*",
    "/api/player/:path*",
    "/api/coach/:path*",
    "/api/manager/:path*",
    "/api/parent/:path*",
    "/api/messages/:path*",
    "/api/rules/:path*",
    "/api/etiquette/:path*",
    "/api/profile/custom-fields",
  ],
};
