import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    if (authErr || !authUser?.user?.email) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    return NextResponse.json({ email: authUser.user.email.toLowerCase() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

