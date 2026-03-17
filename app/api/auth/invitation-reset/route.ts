import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function loadInvitation(supabaseAdmin: any, rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const { data, error } = await supabaseAdmin
    .from("access_invitation_tokens")
    .select("id, user_id, sent_to_email, invitation_kind, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { ok: false as const, reason: "missing" };
  if (data.consumed_at) return { ok: false as const, reason: "consumed" };
  if (new Date(data.expires_at).getTime() <= Date.now()) return { ok: false as const, reason: "expired" };
  return { ok: true as const, row: data };
}

function translateAuthMessage(message: string) {
  if (message === "New password should be different from the old password.") {
    return "Le nouveau mot de passe doit être différent de l’ancien.";
  }
  return message;
}

export async function GET(req: NextRequest) {
  try {
    const token = String(new URL(req.url).searchParams.get("token") ?? "").trim();
    if (!token) return NextResponse.json({ error: "Token manquant" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const invite = await loadInvitation(supabaseAdmin, token);
    if (!invite.ok) {
      return NextResponse.json({ ok: false, error: "Ce lien est invalide ou expiré." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim();
    const password = String(body?.password ?? "");

    if (!token) return NextResponse.json({ error: "Token manquant" }, { status: 400 });
    if (password.length < 8) {
      return NextResponse.json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, { status: 400 });
    }

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const invite = await loadInvitation(supabaseAdmin, token);
    if (!invite.ok) {
      return NextResponse.json({ error: "Ce lien est invalide ou expiré." }, { status: 400 });
    }

    const updateRes = await supabaseAdmin.auth.admin.updateUserById(invite.row.user_id, { password });
    if (updateRes.error) {
      return NextResponse.json({ error: translateAuthMessage(updateRes.error.message) }, { status: 400 });
    }

    const { error: consumeError } = await supabaseAdmin
      .from("access_invitation_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", invite.row.id);
    if (consumeError) throw new Error(consumeError.message);

    return NextResponse.json({ ok: true, email: invite.row.sent_to_email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
