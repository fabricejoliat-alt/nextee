import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function randomPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(req: NextRequest, ctx: any) {
  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceRoleKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const params = await Promise.resolve(ctx?.params);
const clubId: string | undefined = params?.clubId;
    if (!clubId) {
      return NextResponse.json({ error: "Missing clubId in route params" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const email = (body?.email ?? "").trim().toLowerCase();
    const first_name = (body?.first_name ?? "").trim();
    const last_name = (body?.last_name ?? "").trim();
    const role = (body?.role ?? "").trim(); // manager | coach | player

    if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });
    if (!role || !["manager", "coach", "player"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Vérifier que l'appelant est superadmin OU manager de ce club
    // On récupère le token user depuis Authorization Bearer
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const callerId = userData.user.id;

    const { data: adminRow } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    let isAllowed = Boolean(adminRow);

    if (!isAllowed) {
      const { data: membership } = await supabaseAdmin
        .from("club_members")
        .select("id, role, is_active")
        .eq("club_id", clubId)
        .eq("user_id", callerId)
        .eq("is_active", true)
        .maybeSingle();

      isAllowed = Boolean(membership && membership.role === "manager");
    }

    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1) Créer l’utilisateur Auth (admin)
    const tempPassword = randomPassword(12);

    // Si l'utilisateur existe déjà, createUser renverra une erreur
    // => on tente d'abord d'en trouver un par email
    const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });

    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 400 });
    }

    const existing = (listData.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);

    let userId: string;

    if (existing) {
      userId = existing.id;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });

      if (createErr || !created.user) {
        return NextResponse.json({ error: createErr?.message ?? "Create user failed" }, { status: 400 });
      }

      userId = created.user.id;
    }

    // 2) Upsert profile
    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          first_name: first_name || null,
          last_name: last_name || null,
        },
        { onConflict: "id" }
      );

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    // 3) Inscrire dans le club_members
    const { error: memErr } = await supabaseAdmin
      .from("club_members")
      .insert({
        club_id: clubId,
        user_id: userId,
        role,
        is_active: true,
      });

    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 400 });
    }

    // Réponse (on ne renvoie le mot de passe que si user nouveau)
    return NextResponse.json(
      {
        user: { id: userId, email },
        tempPassword: existing ? null : tempPassword,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
