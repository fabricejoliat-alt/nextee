import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadOrganizationAccessSummary } from "@/lib/server/organizationSummary";
import { organizationGateBlocks, requestedOrganizationId } from "@/lib/organizationPolicy";
import { loadLegalGateStatus } from "@/lib/server/legalRequirements";
import { legalRouteKind } from "@/lib/legalRouteCoverage";
import { readOnceFetch } from "@/lib/readOnceFetch";

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

  const bearerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const database = serviceRoleKey && supabaseUrl
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false }, global: { fetch: readOnceFetch } }) : null;
  // Verify the credential actually used by this request once. Cookie-based page
  // requests still refresh their session; bearer API calls remain server-verified.
  const { data } = bearerToken && database
    ? await database.auth.getUser(bearerToken)
    : await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const legalRoute = legalRouteKind(path);
  // Independent reads overlap; neither gate can release business data alone.
  const legalCheck = legalRoute && database && data.user
    ? loadLegalGateStatus(database, data.user.id, requestedOrganizationId(req.url))
      .then(value => ({ value, error: null }), error => ({ value: null, error })) : null;
  const isPlayerPage = path === "/player" || path.startsWith("/player/");
  const isConsentPage = path === "/player/consent-required";
  const isConsentEndpoint = path === "/api/player/consent";
  const requiresPlayerConsent =
    (isPlayerPage && !isConsentPage) ||
    (path.startsWith("/api/player/") && !isConsentEndpoint) ||
    ["/api/parent/", "/api/messages/", "/api/rules/", "/api/etiquette/"].some((prefix) => path.startsWith(prefix)) ||
    path === "/api/profile/custom-fields";

  if (requiresPlayerConsent) {
    if (!database) {
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const supabaseAdmin = database;
    const userId = data.user?.id ?? "";
    if (bearerToken && !userId) {
        return NextResponse.json(
          { error: "Invalid token" },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
    }

    if (userId) {
      try {
        const memberships = await supabaseAdmin.from("organization_members").select("role")
          .eq("user_id", userId).eq("is_active", true);
        if (memberships.error) throw memberships.error;
        if ((memberships.data ?? []).some(row => ["player", "parent"].includes(row.role))) {
          const organizations = await loadOrganizationAccessSummary(supabaseAdmin, userId);
          if (organizationGateBlocks(organizations, requestedOrganizationId(req.url))) {
            if (isPlayerPage) {
              const destination = req.nextUrl.clone(); destination.pathname = "/legal/my"; destination.search = "";
              return NextResponse.redirect(destination);
            }
            return NextResponse.json({ error: "Organization authorization required", code: "PLAYER_CONSENT_REQUIRED" },
              { status: 403, headers: { "Cache-Control": "no-store" } });
          }
        }
      } catch {
        return NextResponse.json({ error: "Unable to verify organization access" },
          { status: 503, headers: { "Cache-Control": "no-store" } });
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

  if (legalRoute) {
    res.headers.set("Cache-Control", "private, no-store");
    if (!database) return NextResponse.json({ error: "Legal gate unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
      if (!legalCheck) {
        const control = await database.from("legal_enforcement_control")
          .select("enabled").eq("singleton", true).maybeSingle();
        if (control.error || !control.data) throw new Error("Legal control unavailable");
        if (control.data.enabled) return NextResponse.json({ error: "Unauthorized" },
          { status: 401, headers: { "Cache-Control": "no-store" } });
      } else {
        const result = await legalCheck;
        if (result.error) throw result.error;
        const { missing } = result.value!;
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
