import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const PLAYER_GUIDE_URL =
  "https://qgyshibomgcuaxhyhrgo.supabase.co/storage/v1/object/public/Docs/ActiviTee_V1_player.pdf";

type AuthUserSummary = {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
};

type InvitationKind = "parent_access" | "junior_access";

type ParentAccessRow = {
  parent_user_id: string;
  parent_name: string;
  parent_username: string | null;
  parent_email: string | null;
  parent_status: "not_ready" | "ready" | "sent" | "activated" | "error";
  parent_last_sent_at: string | null;
  parent_send_count: number;
  linked_juniors: Array<{
    junior_user_id: string;
    junior_name: string;
    junior_username: string | null;
    junior_status: "not_ready" | "ready" | "sent" | "activated" | "error";
    junior_last_sent_at: string | null;
    junior_send_count: number;
  }>;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function resolveAppBaseUrl(req: NextRequest) {
  const configured =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "";
  if (configured.trim()) return configured.trim().replace(/\/+$/, "");
  return new URL(req.url).origin.replace(/\/+$/, "");
}

function cleanName(first: string | null | undefined, last: string | null | undefined) {
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  return name || "Utilisateur";
}

function cleanEmail(raw: string | null | undefined) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email || email.endsWith("@noemail.local")) return null;
  return email;
}

function computeAge(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function parseMailFrom(value: string) {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) {
    return {
      name: m[1].trim().replace(/^"|"$/g, ""),
      email: m[2].trim(),
    };
  }
  return { name: "ActiviTee", email: raw };
}

async function assertManagerOrSuperadmin(req: NextRequest, supabaseAdmin: any, clubId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;

  const { data: adminRow } = await supabaseAdmin.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle();
  if (adminRow) return { ok: true as const, callerId };

  const { data: membership } = await supabaseAdmin
    .from("club_members")
    .select("id,role,is_active")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership || membership.role !== "manager") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const, callerId };
}

async function fetchAuthUsersByIds(supabaseAdmin: any, userIds: string[]) {
  const out = new Map<string, AuthUserSummary>();
  if (userIds.length === 0) return out;

  const wanted = new Set(userIds);
  let page = 1;
  const perPage = 1000;

  while (wanted.size > 0) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      if (!wanted.has(user.id)) continue;
      out.set(user.id, {
        id: user.id,
        email: user.email ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
      });
      wanted.delete(user.id);
    }

    if (users.length < perPage) break;
    page += 1;
  }

  for (const userId of wanted) {
    out.set(userId, { id: userId, email: null, last_sign_in_at: null });
  }

  return out;
}

async function upsertInvitationLog(
  supabaseAdmin: any,
  payload: {
    clubId: string;
    recipientUserId: string;
    targetUserId: string;
    invitationKind: InvitationKind;
    sentToEmail: string;
    sentBy: string;
    lastError?: string | null;
  }
) {
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("access_invitation_logs")
    .select("id,send_count")
    .eq("club_id", payload.clubId)
    .eq("recipient_user_id", payload.recipientUserId)
    .eq("target_user_id", payload.targetUserId)
    .eq("invitation_kind", payload.invitationKind)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from("access_invitation_logs")
      .update({
        sent_to_email: payload.sentToEmail,
        sent_by: payload.sentBy,
        last_sent_at: new Date().toISOString(),
        send_count: Number(existing.send_count ?? 0) + 1,
        last_error: payload.lastError ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin.from("access_invitation_logs").insert({
    club_id: payload.clubId,
    recipient_user_id: payload.recipientUserId,
    target_user_id: payload.targetUserId,
    invitation_kind: payload.invitationKind,
    sent_to_email: payload.sentToEmail,
    sent_by: payload.sentBy,
    last_sent_at: new Date().toISOString(),
    send_count: 1,
    last_error: payload.lastError ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

async function sendBrevoEmail(args: {
  toEmail: string;
  toName: string;
  subject: string;
  textContent: string;
  htmlContent: string;
}) {
  const brevoApiKey = mustEnv("BREVO_API_KEY");
  const sender = parseMailFrom(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>");
  const sendRes = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender,
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

function buildParentEmail(params: {
  clubName: string;
  parentName: string;
  parentUsername: string | null;
  resetUrl: string;
  appUrl: string;
}) {
  const text = [
    `Bonjour ${params.parentName},`,
    "",
    `Votre accès parent ActiviTee pour ${params.clubName} est prêt.`,
    "",
    params.parentUsername ? `Identifiant: ${params.parentUsername}` : "Identifiant: votre compte parent déjà existant",
    `Définir / réinitialiser votre mot de passe: ${params.resetUrl}`,
    `Connexion à l'application: ${params.appUrl}`,
    `Mode d'emploi: ${PLAYER_GUIDE_URL}`,
    "",
    "Depuis votre espace parent, vous pourrez suivre les informations utiles et gérer le consentement de votre enfant si nécessaire.",
    "",
    "L'équipe ActiviTee",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#132018;line-height:1.5">
      <p>Bonjour ${params.parentName},</p>
      <p>Votre accès parent <strong>ActiviTee</strong> pour <strong>${params.clubName}</strong> est prêt.</p>
      <p>${params.parentUsername ? `<strong>Identifiant :</strong> ${params.parentUsername}<br/>` : ""}<strong>Définir / réinitialiser votre mot de passe :</strong> <a href="${params.resetUrl}">Ouvrir le lien sécurisé</a><br/><strong>Connexion à l'application :</strong> <a href="${params.appUrl}">${params.appUrl}</a><br/><strong>Mode d'emploi :</strong> <a href="${PLAYER_GUIDE_URL}">Télécharger le document</a></p>
      <p>Depuis votre espace parent, vous pourrez suivre les informations utiles et gérer le consentement de votre enfant si nécessaire.</p>
      <p>L'équipe ActiviTee</p>
    </div>
  `;

  return { text, html };
}

function buildJuniorEmail(params: {
  clubName: string;
  parentName: string;
  juniorName: string;
  juniorUsername: string | null;
  tempPassword: string;
  appUrl: string;
}) {
  const text = [
    `Bonjour ${params.parentName},`,
    "",
    `Voici les accès ActiviTee de ${params.juniorName} pour ${params.clubName}.`,
    "",
    `Identifiant junior: ${params.juniorUsername ?? "non renseigné"}`,
    `Mot de passe temporaire: ${params.tempPassword}`,
    `Connexion à l'application: ${params.appUrl}`,
    `Mode d'emploi: ${PLAYER_GUIDE_URL}`,
    "",
    "Merci de transmettre ces accès à votre enfant ou de l'accompagner lors de sa première connexion.",
    "",
    "L'équipe ActiviTee",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#132018;line-height:1.5">
      <p>Bonjour ${params.parentName},</p>
      <p>Voici les accès <strong>ActiviTee</strong> de <strong>${params.juniorName}</strong> pour <strong>${params.clubName}</strong>.</p>
      <p><strong>Identifiant junior :</strong> ${params.juniorUsername ?? "non renseigné"}<br/><strong>Mot de passe temporaire :</strong> ${params.tempPassword}<br/><strong>Connexion à l'application :</strong> <a href="${params.appUrl}">${params.appUrl}</a><br/><strong>Mode d'emploi :</strong> <a href="${PLAYER_GUIDE_URL}">Télécharger le document</a></p>
      <p>Merci de transmettre ces accès à votre enfant ou de l'accompagner lors de sa première connexion.</p>
      <p>L'équipe ActiviTee</p>
    </div>
  `;

  return { text, html };
}

function computeStatus(args: {
  email: string | null;
  activatedAt: string | null;
  lastSentAt: string | null;
  lastError: string | null;
}): "not_ready" | "ready" | "sent" | "activated" | "error" {
  if (!args.email) return "not_ready";
  if (args.activatedAt) return "activated";
  if (args.lastError) return "error";
  if (args.lastSentAt) return "sent";
  return "ready";
}

async function loadClubDataset(supabaseAdmin: any, clubId: string) {
  const [clubRes, playersRes, parentsRes, linksRes, logsRes] = await Promise.all([
    supabaseAdmin.from("clubs").select("id,name").eq("id", clubId).maybeSingle(),
    supabaseAdmin
      .from("club_members")
      .select("user_id,player_course_track,is_active,role")
      .eq("club_id", clubId)
      .eq("role", "player")
      .eq("is_active", true),
    supabaseAdmin
      .from("club_members")
      .select("user_id,is_active,role")
      .eq("club_id", clubId)
      .eq("role", "parent")
      .eq("is_active", true),
    supabaseAdmin.from("player_guardians").select("player_id,guardian_user_id,is_primary,relation"),
    supabaseAdmin
      .from("access_invitation_logs")
      .select("recipient_user_id,target_user_id,invitation_kind,last_sent_at,send_count,last_error,sent_to_email")
      .eq("club_id", clubId),
  ]);

  if (clubRes.error) throw new Error(clubRes.error.message);
  if (playersRes.error) throw new Error(playersRes.error.message);
  if (parentsRes.error) throw new Error(parentsRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);

  const rawPlayers = (playersRes.data ?? []) as Array<{ user_id: string; player_course_track: string | null }>;
  const rawParents = (parentsRes.data ?? []) as Array<{ user_id: string }>;
  const rawLinks = (linksRes.data ?? []) as Array<{
    player_id: string | null;
    guardian_user_id: string | null;
    is_primary: boolean | null;
    relation: string | null;
  }>;
  const logs = (logsRes.data ?? []) as Array<{
    recipient_user_id: string;
    target_user_id: string;
    invitation_kind: InvitationKind;
    last_sent_at: string | null;
    send_count: number | null;
    last_error: string | null;
    sent_to_email: string | null;
  }>;

  const playerIds = Array.from(new Set(rawPlayers.map((row) => String(row.user_id ?? "")).filter(Boolean)));
  const parentIds = Array.from(new Set(rawParents.map((row) => String(row.user_id ?? "")).filter(Boolean)));
  const linkedParentIds = Array.from(
    new Set(rawLinks.map((row) => String(row.guardian_user_id ?? "")).filter(Boolean))
  );

  const allProfileIds = Array.from(new Set([...playerIds, ...parentIds, ...linkedParentIds]));
  const profileById = new Map<
    string,
    { id: string; first_name: string | null; last_name: string | null; username: string | null; birth_date: string | null }
  >();
  if (allProfileIds.length > 0) {
    const profilesRes = await supabaseAdmin
      .from("profiles")
      .select("id,first_name,last_name,username,birth_date")
      .in("id", allProfileIds);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    for (const row of profilesRes.data ?? []) {
      profileById.set(String((row as any).id), {
        id: String((row as any).id),
        first_name: ((row as any).first_name ?? null) as string | null,
        last_name: ((row as any).last_name ?? null) as string | null,
        username: ((row as any).username ?? null) as string | null,
        birth_date: ((row as any).birth_date ?? null) as string | null,
      });
    }
  }

  const authById = await fetchAuthUsersByIds(supabaseAdmin, Array.from(new Set([...parentIds, ...playerIds])));

  const eligiblePlayerIds = new Set(
    rawPlayers
      .filter((row) => {
        const playerId = String(row.user_id ?? "");
        if (!playerId) return false;
        const track = String(row.player_course_track ?? "").trim().toLowerCase();
        if (!track || track === "no_course") return false;
        const age = computeAge(profileById.get(playerId)?.birth_date ?? null);
        return !(age != null && age >= 18);
      })
      .map((row) => String(row.user_id ?? ""))
  );

  const eligibleLinks = rawLinks.filter((row) => {
    const playerId = String(row.player_id ?? "");
    const guardianId = String(row.guardian_user_id ?? "");
    return Boolean(playerId && guardianId && eligiblePlayerIds.has(playerId));
  });

  const linksByParent = new Map<string, Array<{ player_id: string; is_primary: boolean | null; relation: string | null }>>();
  const linkedPlayerIds = new Set<string>();
  for (const row of eligibleLinks) {
    const parentId = String(row.guardian_user_id ?? "");
    const playerId = String(row.player_id ?? "");
    linkedPlayerIds.add(playerId);
    const list = linksByParent.get(parentId) ?? [];
    list.push({ player_id: playerId, is_primary: row.is_primary ?? null, relation: row.relation ?? null });
    linksByParent.set(parentId, list);
  }

  const logByKey = new Map<string, (typeof logs)[number]>();
  for (const log of logs) {
    logByKey.set(`${log.invitation_kind}:${log.recipient_user_id}:${log.target_user_id}`, log);
  }

  const parentRows: ParentAccessRow[] = parentIds
    .map((parentUserId) => {
      const parentProfile = profileById.get(parentUserId);
      const parentAuth = authById.get(parentUserId);
      const parentEmail = cleanEmail(parentAuth?.email ?? null);
      const parentLog = logByKey.get(`parent_access:${parentUserId}:${parentUserId}`);
      const juniors = (linksByParent.get(parentUserId) ?? [])
        .map((link) => {
          const juniorProfile = profileById.get(link.player_id);
          const juniorAuth = authById.get(link.player_id);
          const juniorLog = logByKey.get(`junior_access:${parentUserId}:${link.player_id}`);
          return {
            junior_user_id: link.player_id,
            junior_name: cleanName(juniorProfile?.first_name, juniorProfile?.last_name),
            junior_username: juniorProfile?.username ?? null,
            junior_status: computeStatus({
              email: parentEmail,
              activatedAt: juniorAuth?.last_sign_in_at ?? null,
              lastSentAt: juniorLog?.last_sent_at ?? null,
              lastError: juniorLog?.last_error ?? null,
            }),
            junior_last_sent_at: juniorLog?.last_sent_at ?? null,
            junior_send_count: Number(juniorLog?.send_count ?? 0),
          };
        })
        .sort((a, b) => a.junior_name.localeCompare(b.junior_name, "fr"));

      return {
        parent_user_id: parentUserId,
        parent_name: cleanName(parentProfile?.first_name, parentProfile?.last_name),
        parent_username: parentProfile?.username ?? null,
        parent_email: parentEmail,
        parent_status: computeStatus({
          email: parentEmail,
          activatedAt: parentAuth?.last_sign_in_at ?? null,
          lastSentAt: parentLog?.last_sent_at ?? null,
          lastError: parentLog?.last_error ?? null,
        }),
        parent_last_sent_at: parentLog?.last_sent_at ?? null,
        parent_send_count: Number(parentLog?.send_count ?? 0),
        linked_juniors: juniors,
      };
    })
    .sort((a, b) => a.parent_name.localeCompare(b.parent_name, "fr"));

  const juniorsWithoutParent = Array.from(eligiblePlayerIds)
    .filter((playerId) => !linkedPlayerIds.has(playerId))
    .map((playerId) => {
      const profile = profileById.get(playerId);
      const auth = authById.get(playerId);
      return {
        user_id: playerId,
        name: cleanName(profile?.first_name, profile?.last_name),
        username: profile?.username ?? null,
        activated_at: auth?.last_sign_in_at ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return {
    club: { id: String(clubRes.data?.id ?? clubId), name: String(clubRes.data?.name ?? "Club") },
    parents: parentRows,
    juniors_without_parent: juniorsWithoutParent,
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const data = await loadClubDataset(supabaseAdmin, clubId);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? "") as InvitationKind;
    const parentUserId = String(body?.parent_user_id ?? "");
    const juniorUserId = String(body?.junior_user_id ?? "");

    if (kind !== "parent_access" && kind !== "junior_access") {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!parentUserId) return NextResponse.json({ error: "Missing parent_user_id" }, { status: 400 });
    if (kind === "junior_access" && !juniorUserId) {
      return NextResponse.json({ error: "Missing junior_user_id" }, { status: 400 });
    }

    const dataset = await loadClubDataset(supabaseAdmin, clubId);
    const parent = dataset.parents.find((row) => row.parent_user_id === parentUserId);
    if (!parent) return NextResponse.json({ error: "Parent introuvable" }, { status: 404 });
    if (!parent.parent_email) {
      return NextResponse.json({ error: "Aucune adresse e-mail parent exploitable" }, { status: 400 });
    }

    const appBaseUrl = resolveAppBaseUrl(req);
    const appUrl = `${appBaseUrl}/`;
    const resetPasswordUrl = `${appBaseUrl}/reset-password`;

    if (kind === "parent_access") {
      const resetLinkRes = await (supabaseAdmin.auth.admin as any).generateLink({
        type: "recovery",
        email: parent.parent_email,
        options: { redirectTo: resetPasswordUrl },
      });
      const tokenHash =
        resetLinkRes?.data?.properties?.hashed_token ??
        resetLinkRes?.data?.hashed_token ??
        null;
      const verificationType =
        resetLinkRes?.data?.properties?.verification_type ??
        resetLinkRes?.data?.verification_type ??
        "recovery";
      const resetUrl = tokenHash
        ? `${resetPasswordUrl}?token_hash=${encodeURIComponent(String(tokenHash))}&type=${encodeURIComponent(
            String(verificationType || "recovery")
          )}`
        : null;
      if (resetLinkRes?.error || !resetUrl) {
        throw new Error(resetLinkRes?.error?.message ?? "Impossible de générer le lien de connexion parent");
      }

      const mail = buildParentEmail({
        clubName: dataset.club.name,
        parentName: parent.parent_name,
        parentUsername: parent.parent_username,
        resetUrl,
        appUrl,
      });

      try {
        await sendBrevoEmail({
          toEmail: parent.parent_email,
          toName: parent.parent_name,
          subject: `ActiviTee • Accès parent ${dataset.club.name}`,
          textContent: mail.text,
          htmlContent: mail.html,
        });
        await upsertInvitationLog(supabaseAdmin, {
          clubId,
          recipientUserId: parent.parent_user_id,
          targetUserId: parent.parent_user_id,
          invitationKind: "parent_access",
          sentToEmail: parent.parent_email,
          sentBy: auth.callerId,
          lastError: null,
        });
      } catch (error: any) {
        await upsertInvitationLog(supabaseAdmin, {
          clubId,
          recipientUserId: parent.parent_user_id,
          targetUserId: parent.parent_user_id,
          invitationKind: "parent_access",
          sentToEmail: parent.parent_email,
          sentBy: auth.callerId,
          lastError: error?.message ?? "Email send failed",
        });
        throw error;
      }

      return NextResponse.json({ ok: true });
    }

    const junior = parent.linked_juniors.find((row) => row.junior_user_id === juniorUserId);
    if (!junior) return NextResponse.json({ error: "Junior introuvable pour ce parent" }, { status: 404 });

    const tempPassword = randomPassword(12);
    const updateRes = await supabaseAdmin.auth.admin.updateUserById(juniorUserId, { password: tempPassword });
    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
    }

    const mail = buildJuniorEmail({
      clubName: dataset.club.name,
      parentName: parent.parent_name,
      juniorName: junior.junior_name,
      juniorUsername: junior.junior_username,
      tempPassword,
      appUrl,
    });

    try {
      await sendBrevoEmail({
        toEmail: parent.parent_email,
        toName: parent.parent_name,
        subject: `ActiviTee • Accès junior ${junior.junior_name}`,
        textContent: mail.text,
        htmlContent: mail.html,
      });
      await upsertInvitationLog(supabaseAdmin, {
        clubId,
        recipientUserId: parent.parent_user_id,
        targetUserId: juniorUserId,
        invitationKind: "junior_access",
        sentToEmail: parent.parent_email,
        sentBy: auth.callerId,
        lastError: null,
      });
    } catch (error: any) {
      await upsertInvitationLog(supabaseAdmin, {
        clubId,
        recipientUserId: parent.parent_user_id,
        targetUserId: juniorUserId,
        invitationKind: "junior_access",
        sentToEmail: parent.parent_email,
        sentBy: auth.callerId,
        lastError: error?.message ?? "Email send failed",
      });
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
