import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function randomPassword(len = 14) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*?";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const email = String(body.email || "").trim().toLowerCase();
    const first_name = String(body.first_name || "").trim();
    const last_name = String(body.last_name || "").trim();

    if (!email || !first_name || !last_name) {
      return NextResponse.json(
        { error: "Prénom, nom et email requis." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Vérifier que l'appelant est superadmin
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) {
      return NextResponse.json({ error: "Missing Authorization token." }, { status: 401 });
    }

    const { data: callerData, error: callerErr } =
      await supabaseAdmin.auth.getUser(accessToken);

    if (callerErr || !callerData.user) {
      return NextResponse.json({ error: "Invalid token." }, { status: 401 });
    }

    const callerId = callerData.user.id;

    const { data: isAdminRow, error: isAdminErr } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (isAdminErr || !isAdminRow) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Créer utilisateur Auth (mot de passe temporaire MVP)
    const tempPassword = randomPassword();
    const { data: created, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });

    if (createErr || !created.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "Create user failed" },
        { status: 400 }
      );
    }

    const newUserId = created.user.id;

    // Upsert profile (prénom/nom)
    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: newUserId, first_name, last_name }, { onConflict: "id" });

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    return NextResponse.json({
      user: { id: newUserId, email },
      tempPassword,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
