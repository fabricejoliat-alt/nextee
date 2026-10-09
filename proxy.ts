import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadOrganizationAccessSummary } from "@/lib/server/organizationSummary";
import { organizationGateBlocks, requestedOrganizationId } from "@/lib/organizationPolicy";
import { loadLegalGateStatus } from "@/lib/server/legalRequirements";
import { legalRouteKind } from "@/lib/legalRouteCoverage";
import { readOnceFetch } from "@/lib/readOnceFetch";
import { initialPasswordRequired, isLegacyManagerAdminRoute } from "@/lib/adminSecurity";
import { verifiedAdminAssurance, adminNoStore } from "@/lib/server/adminSecurity";
import { adminContentSecurityPolicy } from "@/lib/securityHeaders";

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const adminPage = path === "/admin" || path.startsWith("/admin/");
  const adminApi = path.startsWith("/api/admin/");
  const requestHeaders = new Headers(req.headers);
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64");
  const adminCsp = adminContentSecurityPolicy(nonce, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV === "development");
  if (adminPage) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", adminCsp);
  }
  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  if (adminPage || adminApi) res.headers.set("Cache-Control", adminNoStore["Cache-Control"]);
  if (adminPage) res.headers.set("Content-Security-Policy", adminCsp);

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

  // Enforce the initial-password flag from trusted app_metadata, before business reads.
  if (data.user && initialPasswordRequired(data.user)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Choose your own password first", code: "INITIAL_PASSWORD_REQUIRED" },
      { status: 403, headers: adminNoStore });
    return NextResponse.redirect(new URL("/change-initial-password", req.url), { headers: adminNoStore });
  }

  if (adminPage || adminApi) {
    if (!database) return NextResponse.json({ error: "Admin access unavailable" }, { status: 503, headers: adminNoStore });
    if (!data.user || (adminApi && !bearerToken)) {
      if (adminApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: adminNoStore });
      return NextResponse.redirect(new URL("/login?next=%2Fadmin", req.url), { headers: adminNoStore });
    }
    try {
      const admin = await database.from("app_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
      if (admin.error) throw admin.error;
      // These historical APIs retain their own active-club manager checks.
      if (!admin.data && adminApi && isLegacyManagerAdminRoute(path)) return res;
      if (!admin.data) return adminApi
        ? NextResponse.json({ error: "Forbidden" }, { status: 403, headers: adminNoStore })
        : NextResponse.redirect(new URL("/no-access", req.url), { headers: adminNoStore });
      // The page renders only the MFA gate at aal1; no Admin children mount yet.
      if (adminPage || (path === "/api/admin/security" && req.method === "GET")) return res;
      const assurance = await verifiedAdminAssurance(database, bearerToken, data.user.id);
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (!assurance.mfa || (mutation && !assurance.recent)) return NextResponse.json({
        error: "Confirmez votre identité avec un code de votre application d’authentification, puis réessayez.",
        code: assurance.mfa ? "ADMIN_REAUTH_REQUIRED" : "ADMIN_MFA_REQUIRED",
      }, { status: 403, headers: adminNoStore });
      return res;
    } catch {
      return NextResponse.json({ error: "Admin verification unavailable" }, { status: 503, headers: adminNoStore });
    }
  }
  const legalRoute = legalRouteKind(path);
  // Independent reads overlap; neither gate can release business data alone.
  const legalCheck = legalRoute && database && data.user
    ? loadLegalGateStatus(database, data.user.id, requestedOrganizationId(req.url))
      .then(value => ({ value, error: null }), error => ({ value: null, error })) : null;
  // A platform admin must not bypass MFA through legacy Manager/Coach APIs.
  // This role lookup overlaps the existing legal checks for ordinary users.
  if (path.startsWith("/api/") && database && data.user) {
    try {
      const admin = await database.from("app_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
      if (admin.error) throw admin.error;
      if (admin.data) {
        const assurance = await verifiedAdminAssurance(database, bearerToken, data.user.id);
        if (!assurance.mfa || (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !assurance.recent))
          return NextResponse.json({ error: "Admin identity verification required", code: assurance.mfa ? "ADMIN_REAUTH_REQUIRED" : "ADMIN_MFA_REQUIRED" },
            { status: 403, headers: adminNoStore });
      }
    } catch { return NextResponse.json({ error: "Admin verification unavailable" }, { status: 503, headers: adminNoStore }); }
  }
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
    "/api/admin/:path*",
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
