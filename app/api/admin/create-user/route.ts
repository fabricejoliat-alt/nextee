import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function randomPassword(len = 14) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*?";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function normalizeToken(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

async function generateUniqueUsername(supabaseAdmin: any, firstName: string, lastName: string) {
  const first = normalizeToken(firstName);
  const last = normalizeToken(lastName);
  const baseRaw = [first, last].filter(Boolean).join(".");
  const base = baseRaw || `user.${Date.now().toString().slice(-6)}`;

  let candidate = base;
  let suffix = 1;
  while (suffix <= 500) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", candidate)
      .limit(1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;

    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  throw new Error("Impossible de générer un username unique.");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const emailInput = String(body.email || "").trim().toLowerCase();
    const first_name = String(body.first_name || "").trim();
    const last_name = String(body.last_name || "").trim();
    const role = String(body.role || "player").trim().toLowerCase();
    const allowedRoles = new Set(["manager", "coach", "player", "parent", "captain", "staff"]);

    if (!first_name || !last_name) {
      return NextResponse.json(
        { error: "Prénom et nom requis." },
        { status: 400 }
      );
    }
    if (!allowedRoles.has(role)) {
      return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
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
    const username = await generateUniqueUsername(supabaseAdmin, first_name, last_name);
    const email = emailInput || `${username}.${Date.now()}@noemail.local`;
    const tempPassword = randomPassword();
    const { data: created, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          username,
          role,
        },
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
      .upsert(
        {
          id: newUserId,
          first_name,
          last_name,
          username,
          app_role: role,
        },
        { onConflict: "id" }
      );

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    return NextResponse.json({
      user: { id: newUserId, email: emailInput || null },
      tempPassword,
      username,
      role,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
