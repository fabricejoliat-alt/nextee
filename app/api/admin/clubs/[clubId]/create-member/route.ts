import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ClubRole = "manager" | "coach" | "player";

function randomPassword(len = 14) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*?";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(req: Request, ctx: { params: { clubId: string } }) {
  try {
    const clubId = ctx.params.clubId;

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const first_name = String(body.first_name || "").trim();
    const last_name = String(body.last_name || "").trim();
    const role = String(body.role || "player") as ClubRole;

    if (!email || !first_name || !last_name) {
      return NextResponse.json(
        { error: "Prénom, nom et email requis." },
        { status: 400 }
      );
    }
    if (!["manager", "coach", "player"].includes(role)) {
      return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Auth du caller via token (superadmin / manager)
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) {
      return NextResponse.json({ error: "Missing Authorization token." }, { status: 401 });
    }

    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) {
      return NextResponse.json({ error: "Invalid token." }, { status: 401 });
    }
    const callerId = callerData.user.id;

    // superadmin ?
    const { data: adminRow } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    // sinon manager du club ?
    if (!adminRow) {
      const { data: managerRow } = await supabaseAdmin
        .from("club_members")
        .select("id")
        .eq("club_id", clubId)
        .eq("user_id", callerId)
        .eq("role", "manager")
        .eq("is_active", true)
        .maybeSingle();

      if (!managerRow) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    }

    // Créer user auth (password temporaire)
    const tempPassword = randomPassword();
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (createErr || !created.user) {
      return NextResponse.json({ error: createErr?.message ?? "Create user failed" }, { status: 400 });
    }

    const newUserId = created.user.id;

    // Upsert profile (prénom/nom)
    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: newUserId, first_name, last_name }, { onConflict: "id" });

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    // Add to club_members
    const { error: memberErr } = await supabaseAdmin.from("club_members").insert({
      club_id: clubId,
      user_id: newUserId,
      role,
      is_active: true,
    });

    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 400 });
    }

    return NextResponse.json({
      user: { id: newUserId, email },
      tempPassword,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
