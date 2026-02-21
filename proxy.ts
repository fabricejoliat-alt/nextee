import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({
    request: { headers: req.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );

  // ✅ refresh / récupère l'utilisateur si session encore valable
  const { data } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;

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
  ],
};