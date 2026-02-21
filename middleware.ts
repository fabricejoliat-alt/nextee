import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
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

  const isProtected = req.nextUrl.pathname.startsWith("/player");
  const isLogin = req.nextUrl.pathname.startsWith("/login");

  if (isProtected && !data.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Optionnel: déjà loggé -> pas besoin d'aller sur /login
  if (isLogin && data.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/player";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/player/:path*", "/login"],
};