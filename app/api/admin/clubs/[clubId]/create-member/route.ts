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

function normalizeToken(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

async function generateUniqueUsername(
  supabaseAdmin: any,
  firstName: string,
  lastName: string,
  ignoreUserId?: string
) {
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
      .limit(5);

    if (error) throw new Error(error.message);
    const takenByOther = (data ?? []).some((r: any) => String(r.id) !== String(ignoreUserId ?? ""));
    if (!takenByOther) return candidate;

    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  throw new Error("Impossible de générer un username unique.");
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
    const emailInput = (body?.email ?? "").trim().toLowerCase();
    const first_name = (body?.first_name ?? "").trim();
    const last_name = (body?.last_name ?? "").trim();
    const phone = (body?.phone ?? "").trim();
    const role = (body?.role ?? "").trim(); // manager | coach | player | parent

    if (!role || !["manager", "coach", "player", "parent"].includes(role)) {
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

    const existing = emailInput
      ? (listData.users ?? []).find((u) => (u.email ?? "").toLowerCase() === emailInput)
      : null;
    const email = emailInput || `member.${Date.now()}.${Math.floor(Math.random() * 10000)}@noemail.local`;

    let userId: string;
    let username: string | null = null;

    if (existing) {
      userId = existing.id;
      const { data: existingProfile, error: existingProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("username,first_name,last_name")
        .eq("id", userId)
        .maybeSingle();
      if (existingProfileErr) {
        return NextResponse.json({ error: existingProfileErr.message }, { status: 400 });
      }

      username =
        (typeof existingProfile?.username === "string" && existingProfile.username.trim() !== ""
          ? existingProfile.username.trim().toLowerCase()
          : null);
      if (!username) {
        const fn = first_name || existingProfile?.first_name || "parent";
        const ln = last_name || existingProfile?.last_name || "user";
        username = await generateUniqueUsername(supabaseAdmin, fn, ln, userId);
      }
    } else {
      username = await generateUniqueUsername(supabaseAdmin, first_name, last_name);
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          username,
          role,
        },
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
          phone: phone || null,
          username,
          app_role: role || null,
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
        user: { id: userId, email: emailInput || null },
        tempPassword: existing ? null : tempPassword,
        username,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
