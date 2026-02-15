import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // caller
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;

    // superadmin only
    const { data: adminRow } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (!adminRow) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const userId = String(body.userId || "").trim();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    // Update profile fields
    const profilePatch: any = {
  first_name: (body.first_name ?? null),
  last_name: (body.last_name ?? null),
  birth_date: (body.birth_date ?? null),
  nationality: (body.nationality ?? null),
  sex: (body.sex ?? null),
  handicap: (body.handicap ?? null),
  address: (body.address ?? null),
  postal_code: (body.postal_code ?? null),
  locality: (body.locality ?? null),
  phone: (body.phone ?? null),
};


    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update(profilePatch)
      .eq("id", userId);

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

    // Update auth email/password (optional)
    const nextEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const nextPassword = typeof body.auth_password === "string" ? body.auth_password : "";

    if (nextEmail || nextPassword) {
      const patch: any = {};
      if (nextEmail) patch.email = nextEmail;
      if (nextPassword) patch.password = nextPassword;

      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, patch);
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
