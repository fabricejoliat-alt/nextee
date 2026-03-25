import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

async function fetchAuthEmailByUserId(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  const authUsersRes = await supabaseAdmin.schema("auth").from("users").select("email").eq("id", userId).maybeSingle();
  if (!authUsersRes.error) {
    const email = typeof authUsersRes.data?.email === "string" ? authUsersRes.data.email.toLowerCase() : null;
    if (email) return { email, error: null };
  }

  const adminRes = await supabaseAdmin.auth.admin.getUserById(userId);
  if (adminRes.error) return { email: null, error: authUsersRes.error ?? adminRes.error };

  return {
    email: typeof adminRes.data?.user?.email === "string" ? adminRes.data.user.email.toLowerCase() : null,
    error: null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const identifier = String(body?.identifier ?? "").trim().toLowerCase();

    if (!identifier) {
      return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
    }

    // If input is already an email, keep native auth flow.
    if (identifier.includes("@")) {
      return NextResponse.json({ email: identifier });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", identifier)
      .maybeSingle();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    if (!profile?.id) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const authUser = await fetchAuthEmailByUserId(supabaseAdmin, String(profile.id));
    if (authUser.error || !authUser.email) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    return NextResponse.json({ email: authUser.email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
