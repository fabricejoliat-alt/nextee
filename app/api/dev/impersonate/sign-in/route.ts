import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertDevImpersonationEnabled } from "@/lib/devImpersonation";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    assertDevImpersonationEnabled(req);

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id ?? "").trim();
    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const userRes = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userRes.error || !userRes.data.user) {
      return NextResponse.json({ error: userRes.error?.message ?? "User not found" }, { status: 404 });
    }

    const email = String(userRes.data.user.email ?? "").trim();
    if (!email) {
      return NextResponse.json({ error: "This user has no login email in Auth." }, { status: 400 });
    }

    const redirectTo = `${req.nextUrl.origin}/dev/impersonate/complete`;
    const linkRes = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkRes.error || !linkRes.data?.properties?.hashed_token || !linkRes.data?.properties?.verification_type) {
      return NextResponse.json({ error: linkRes.error?.message ?? "Could not generate sign-in link." }, { status: 400 });
    }

    return NextResponse.json(
      {
        token_hash: linkRes.data.properties.hashed_token,
        verification_type: linkRes.data.properties.verification_type,
        email,
        redirect_to: redirectTo,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 403 });
  }
}
