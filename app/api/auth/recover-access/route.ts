import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function createAdminClient() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeUsableEmail(raw: string | null | undefined) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.endsWith("@noemail.local")) return "";
  return email;
}

function parseMailFrom(raw: string) {
  const value = String(raw ?? "").trim();
  const match = value.match(/^(.*)<([^>]+)>$/);
  if (!match) return { email: value || "noreply@activitee.golf", name: "ActiviTee" };
  return { name: match[1].trim().replace(/^"|"$/g, "") || "ActiviTee", email: match[2].trim() };
}

async function sendBrevoEmail(args: {
  toEmail: string;
  toName: string;
  subject: string;
  textContent: string;
  htmlContent: string;
}) {
  const sendRes = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": mustEnv("BREVO_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: parseMailFrom(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>"),
      to: [{ email: args.toEmail, name: args.toName }],
      subject: args.subject,
      textContent: args.textContent,
      htmlContent: args.htmlContent,
    }),
  });

  const sendJson = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    throw new Error(String(sendJson?.message ?? "Email send failed"));
  }
}

async function findAuthUserByEmail(supabaseAdmin: ReturnType<typeof createAdminClient>, email: string) {
  let page = 1;
  const perPage = 1000;
  const wanted = email.toLowerCase();

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    if (users.length === 0) return null;

    const found = users.find((user) => normalizeUsableEmail(user.email) === wanted);
    if (found) return found;

    if (users.length < perPage) return null;
    page += 1;
  }
}

async function generateRecoveryUrl(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  email: string,
  appBaseUrl: string
) {
  const redirectTo = `${appBaseUrl}/reset-password`;
  const linkRes = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  const tokenHash = String(linkRes.data?.properties?.hashed_token ?? "").trim();
  const verificationType = String(linkRes.data?.properties?.verification_type ?? "recovery").trim() || "recovery";
  if (linkRes.error || !tokenHash) {
    throw new Error(linkRes.error?.message ?? "Unable to generate recovery link");
  }

  return `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(verificationType)}`;
}

async function issueAccountRecoveryToken(args: {
  supabaseAdmin: ReturnType<typeof createAdminClient>;
  clubId: string;
  userId: string;
  sentToEmail: string;
  sentBy: string;
}) {
  const rawToken = randomBytes(24).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

  const { error } = await args.supabaseAdmin.from("access_invitation_tokens").insert({
    club_id: args.clubId,
    user_id: args.userId,
    invitation_kind: "account_recovery",
    sent_to_email: args.sentToEmail,
    token_hash: tokenHash,
    expires_at: expiresAt,
    consumed_at: null,
    sent_by: args.sentBy,
  });
  if (error) throw new Error(error.message);

  return rawToken;
}

function resolveAppBaseUrl(req: NextRequest) {
  const explicit = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return req.nextUrl.origin.replace(/\/+$/, "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildStandardRecoveryMail(args: { username: string | null; resetUrl: string; name: string }) {
  const usernameLine = args.username ? `Identifiant: ${args.username}` : "Identifiant: non disponible";
  return {
    subject: "Récupération de vos accès ActiviTee",
    text: [
      `Bonjour ${args.name},`,
      "",
      "Vous avez demandé la récupération de vos accès ActiviTee.",
      usernameLine,
      "",
      "Pour définir un nouveau mot de passe :",
      args.resetUrl,
      "",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.",
    ].join("\n"),
    html: [
      `<p>Bonjour ${escapeHtml(args.name)},</p>`,
      "<p>Vous avez demandé la récupération de vos accès ActiviTee.</p>",
      `<p><strong>${escapeHtml(usernameLine)}</strong></p>`,
      `<p><a href="${escapeHtml(args.resetUrl)}">Définir un nouveau mot de passe</a></p>`,
      "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.</p>",
    ].join(""),
  };
}

function buildParentRecoveryMail(args: {
  parentName: string;
  juniorName: string;
  juniorUsername: string | null;
  resetUrl: string;
}) {
  const usernameLine = args.juniorUsername ? `Identifiant junior: ${args.juniorUsername}` : "Identifiant junior: non disponible";
  return {
    subject: `Récupération des accès de ${args.juniorName} sur ActiviTee`,
    text: [
      `Bonjour ${args.parentName},`,
      "",
      `Vous recevez ce lien pour réinitialiser l'accès ActiviTee de ${args.juniorName}.`,
      usernameLine,
      "",
      "Pour définir un nouveau mot de passe :",
      args.resetUrl,
      "",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.",
    ].join("\n"),
    html: [
      `<p>Bonjour ${escapeHtml(args.parentName)},</p>`,
      `<p>Vous recevez ce lien pour réinitialiser l'accès ActiviTee de <strong>${escapeHtml(args.juniorName)}</strong>.</p>`,
      `<p><strong>${escapeHtml(usernameLine)}</strong></p>`,
      `<p><a href="${escapeHtml(args.resetUrl)}">Définir un nouveau mot de passe</a></p>`,
      "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.</p>",
    ].join(""),
  };
}

async function fetchProfileLite(supabaseAdmin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,first_name,last_name,username")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data
    ? {
        id: String((data as any).id ?? ""),
        first_name: ((data as any).first_name ?? null) as string | null,
        last_name: ((data as any).last_name ?? null) as string | null,
        username: ((data as any).username ?? null) as string | null,
      }
    : null;
}

function fullName(profile?: { first_name: string | null; last_name: string | null } | null) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "Bonjour";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const identifier = String(body?.identifier ?? "").trim();
    if (!identifier) {
      return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
    }

    const appBaseUrl = resolveAppBaseUrl(req);
    const supabaseAdmin = createAdminClient();

    let targetUserId = "";
    let targetEmail = "";

    if (identifier.includes("@")) {
      const authUser = await findAuthUserByEmail(supabaseAdmin, identifier);
      targetUserId = String(authUser?.id ?? "").trim();
      targetEmail = normalizeUsableEmail(authUser?.email);
    } else {
      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("username", identifier)
        .maybeSingle();
      if (error) throw new Error(error.message);
      targetUserId = String(profile?.id ?? "").trim();
      if (targetUserId) {
        const authUserRes = await supabaseAdmin.auth.admin.getUserById(targetUserId);
        targetEmail = normalizeUsableEmail(authUserRes.data?.user?.email);
      }
    }

    if (!targetUserId) {
      return NextResponse.json({ ok: true });
    }

    const targetProfile = await fetchProfileLite(supabaseAdmin, targetUserId);
    const targetName = fullName(targetProfile);
    const username = String(targetProfile?.username ?? "").trim() || null;

    if (targetEmail) {
      const resetUrl = await generateRecoveryUrl(supabaseAdmin, targetEmail, appBaseUrl);
      const mail = buildStandardRecoveryMail({ username, resetUrl, name: targetName });
      await sendBrevoEmail({
        toEmail: targetEmail,
        toName: targetName,
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
      });
      return NextResponse.json({ ok: true });
    }

    const { data: memberships, error: membershipsErr } = await supabaseAdmin
      .from("club_members")
      .select("club_id,role,is_active")
      .eq("user_id", targetUserId)
      .eq("is_active", true);
    if (membershipsErr) throw new Error(membershipsErr.message);

    const playerClubId = String(
      (memberships ?? []).find((row: any) => String(row.role ?? "") === "player")?.club_id ??
        (memberships ?? [])[0]?.club_id ??
        ""
    ).trim();
    if (!playerClubId) {
      return NextResponse.json({ ok: true });
    }

    const { data: guardians, error: guardiansErr } = await supabaseAdmin
      .from("player_guardians")
      .select("guardian_user_id,can_edit")
      .eq("player_id", targetUserId)
      .eq("can_edit", true);
    if (guardiansErr) throw new Error(guardiansErr.message);

    const guardianIds = Array.from(
      new Set((guardians ?? []).map((row: any) => String(row.guardian_user_id ?? "").trim()).filter(Boolean))
    );
    if (guardianIds.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const guardianProfilesRes = await supabaseAdmin
      .from("profiles")
      .select("id,first_name,last_name")
      .in("id", guardianIds);
    if (guardianProfilesRes.error) throw new Error(guardianProfilesRes.error.message);
    const guardianProfileById = new Map<string, { first_name: string | null; last_name: string | null }>();
    for (const row of guardianProfilesRes.data ?? []) {
      guardianProfileById.set(String((row as any).id ?? ""), {
        first_name: ((row as any).first_name ?? null) as string | null,
        last_name: ((row as any).last_name ?? null) as string | null,
      });
    }

    for (const guardianId of guardianIds) {
      const authRes = await supabaseAdmin.auth.admin.getUserById(guardianId);
      const parentEmail = normalizeUsableEmail(authRes.data?.user?.email);
      if (!parentEmail) continue;

      const rawToken = await issueAccountRecoveryToken({
        supabaseAdmin,
        clubId: playerClubId,
        userId: targetUserId,
        sentToEmail: parentEmail,
        sentBy: guardianId,
      });
      const resetUrl = `${appBaseUrl}/reset-password?invite_token=${encodeURIComponent(rawToken)}`;
      const parentProfile = guardianProfileById.get(guardianId) ?? null;
      const mail = buildParentRecoveryMail({
        parentName: fullName(parentProfile),
        juniorName: targetName,
        juniorUsername: username,
        resetUrl,
      });

      await sendBrevoEmail({
        toEmail: parentEmail,
        toName: fullName(parentProfile),
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
