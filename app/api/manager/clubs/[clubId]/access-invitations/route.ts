import { createHash, randomBytes } from "crypto";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  cleanFamilyEmail,
  defaultFamilyMailConfig,
  PLAYER_GUIDE_URL,
  renderFamilyTemplate,
  type AccessStatus,
  type FamilyMailConfig,
  type InvitationKind,
} from "@/lib/familyAccess";

export const runtime = "nodejs";

type AuthSummary = { email: string | null; last_sign_in_at: string | null };
type Profile = { id: string; first_name: string | null; last_name: string | null; username: string | null };
type GuardianLink = { player_id: string; guardian_user_id: string; relation: string | null; is_primary: boolean | null };
type InvitationLog = { recipient_user_id: string; target_user_id: string; invitation_kind: InvitationKind; last_sent_at: string | null; send_count: number | null; last_error: string | null; sent_to_email: string | null };

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function fullName(profile: Profile | undefined) {
  return `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "Utilisateur";
}

function appBaseUrl() {
  const configured = [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL]
    .map((value) => String(value ?? "").trim())
    .find((value) => value && !/localhost|127\.0\.0\.1/i.test(value));
  return (configured || "https://www.activitee.golf").replace(/\/+$/, "");
}

function randomPassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function authorize(req: NextRequest, db: any, clubId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { ok: false as const, status: 401, error: "Missing token" };
  const caller = await db.auth.getUser(token);
  if (caller.error || !caller.data.user) return { ok: false as const, status: 401, error: "Invalid token" };
  const callerId = caller.data.user.id;
  const [admin, membership] = await Promise.all([
    db.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", callerId).eq("role", "manager").eq("is_active", true).maybeSingle(),
  ]);
  if (!admin.data && !membership.data) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, callerId };
}

async function authUsers(db: any, ids: string[]) {
  const result = new Map<string, AuthSummary>();
  const wanted = new Set(ids);
  for (let page = 1; wanted.size > 0; page += 1) {
    const response = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (response.error) throw response.error;
    const users = response.data?.users ?? [];
    for (const user of users) {
      if (!wanted.has(user.id)) continue;
      result.set(user.id, { email: cleanFamilyEmail(user.email), last_sign_in_at: user.last_sign_in_at ?? null });
      wanted.delete(user.id);
    }
    if (users.length < 1000) break;
  }
  for (const id of wanted) result.set(id, { email: null, last_sign_in_at: null });
  return result;
}

async function loadFamilyMailConfig(db: any, clubId: string): Promise<FamilyMailConfig> {
  const defaults = defaultFamilyMailConfig();
  let response: any = await db
    .from("club_access_invitation_mail_configs")
    .select("parent_subject,parent_body,junior_subject,junior_body,junior_direct_subject,junior_direct_body,junior_parent_subject,junior_parent_body,consent_subject,consent_body,periodic_report_subject,periodic_report_body")
    .eq("club_id", clubId)
    .maybeSingle();
  if (response.error && /column|schema cache/i.test(response.error.message)) {
    response = await db
      .from("club_access_invitation_mail_configs")
      .select("parent_subject,parent_body,junior_subject,junior_body,junior_direct_subject,junior_direct_body,junior_parent_subject,junior_parent_body,consent_subject,consent_body")
      .eq("club_id", clubId)
      .maybeSingle();
    if (response.error && /column|schema cache/i.test(response.error.message)) {
      response = await db
        .from("club_access_invitation_mail_configs")
        .select("parent_subject,parent_body,junior_subject,junior_body")
        .eq("club_id", clubId)
        .maybeSingle();
    }
  }
  if (response.error) throw new Error(response.error.message);
  const row = response.data;
  return {
    parent_subject: String(row?.parent_subject ?? defaults.parent_subject),
    parent_body: String(row?.parent_body ?? defaults.parent_body),
    junior_direct_subject: String(row?.junior_direct_subject ?? row?.junior_subject ?? defaults.junior_direct_subject),
    junior_direct_body: String(row?.junior_direct_body ?? row?.junior_body ?? defaults.junior_direct_body),
    junior_parent_subject: String(row?.junior_parent_subject ?? row?.junior_subject ?? defaults.junior_parent_subject),
    junior_parent_body: String(row?.junior_parent_body ?? row?.junior_body ?? defaults.junior_parent_body),
    consent_subject: String(row?.consent_subject ?? defaults.consent_subject),
    consent_body: String(row?.consent_body ?? defaults.consent_body),
    periodic_report_subject: String(row?.periodic_report_subject ?? defaults.periodic_report_subject),
    periodic_report_body: String(row?.periodic_report_body ?? defaults.periodic_report_body),
  };
}

function latestLog(logs: InvitationLog[], kind: InvitationKind, targetUserId: string, recipientUserId?: string) {
  return logs
    .filter((log) => log.invitation_kind === kind && log.target_user_id === targetUserId && (!recipientUserId || log.recipient_user_id === recipientUserId))
    .sort((left, right) => String(right.last_sent_at ?? "").localeCompare(String(left.last_sent_at ?? "")))[0];
}

function accessStatus(args: { email: string | null; username: string | null; activatedAt: string | null; log?: InvitationLog; expiresAt?: string | null }): AccessStatus {
  if (!args.email || !args.username) return "not_ready";
  if (args.activatedAt) return "activated";
  if (args.log?.last_error) return "error";
  if (args.expiresAt && new Date(args.expiresAt).getTime() < Date.now()) return "expired";
  if (args.log?.last_sent_at) return "sent";
  return "ready";
}

async function loadDataset(db: any, clubId: string) {
  const [club, members, links, logs, tokens] = await Promise.all([
    db.from("clubs").select("id,name").eq("id", clubId).maybeSingle(),
    db.from("club_members").select("user_id,role,is_active").eq("club_id", clubId).eq("is_active", true).in("role", ["player", "parent"]),
    db.from("player_guardians").select("player_id,guardian_user_id,relation,is_primary"),
    db.from("access_invitation_logs").select("recipient_user_id,target_user_id,invitation_kind,last_sent_at,send_count,last_error,sent_to_email").eq("club_id", clubId),
    db.from("access_invitation_tokens").select("user_id,expires_at,consumed_at,created_at").eq("club_id", clubId).eq("invitation_kind", "parent_access").order("created_at", { ascending: false }),
  ]);
  for (const response of [club, members, links, logs, tokens]) if (response.error) throw new Error(response.error.message);

  const playerIds = new Set<string>();
  const parentIds = new Set<string>();
  for (const member of members.data ?? []) {
    if (member.role === "player") playerIds.add(String(member.user_id));
    if (member.role === "parent") parentIds.add(String(member.user_id));
  }
  const relevantLinks = ((links.data ?? []) as GuardianLink[]).filter((link) => playerIds.has(String(link.player_id)));
  relevantLinks.forEach((link) => parentIds.add(String(link.guardian_user_id)));
  const allIds = Array.from(new Set([...playerIds, ...parentIds]));
  const profiles = new Map<string, Profile>();
  if (allIds.length) {
    const response = await db.from("profiles").select("id,first_name,last_name,username").in("id", allIds);
    if (response.error) throw new Error(response.error.message);
    for (const profile of response.data ?? []) profiles.set(String(profile.id), profile as Profile);
  }
  const auth = await authUsers(db, allIds);
  const invitationLogs = (logs.data ?? []) as InvitationLog[];
  const tokenByParent = new Map<string, { expires_at: string | null; consumed_at: string | null }>();
  for (const token of tokens.data ?? []) if (!tokenByParent.has(String(token.user_id))) tokenByParent.set(String(token.user_id), token);

  const linksByPlayer = new Map<string, GuardianLink[]>();
  const linksByParent = new Map<string, GuardianLink[]>();
  for (const link of relevantLinks) {
    linksByPlayer.set(link.player_id, [...(linksByPlayer.get(link.player_id) ?? []), link]);
    linksByParent.set(link.guardian_user_id, [...(linksByParent.get(link.guardian_user_id) ?? []), link]);
  }

  const parents = Array.from(parentIds).map((id) => {
    const profile = profiles.get(id);
    const authUser = auth.get(id);
    const log = latestLog(invitationLogs, "parent_access", id, id);
    const token = tokenByParent.get(id);
    return {
      parent_user_id: id,
      parent_name: fullName(profile),
      parent_username: profile?.username ?? null,
      parent_email: authUser?.email ?? null,
      parent_status: accessStatus({ email: authUser?.email ?? null, username: profile?.username ?? null, activatedAt: authUser?.last_sign_in_at ?? null, log, expiresAt: token && !token.consumed_at ? token.expires_at : null }),
      parent_last_sent_at: log?.last_sent_at ?? null,
      parent_last_activity_at: authUser?.last_sign_in_at ?? null,
      parent_send_count: Number(log?.send_count ?? 0),
      linked_juniors: (linksByParent.get(id) ?? []).map((link) => ({
        junior_user_id: link.player_id,
        junior_name: fullName(profiles.get(link.player_id)),
        relation: link.relation,
        is_primary: Boolean(link.is_primary),
      })),
    };
  }).sort((left, right) => left.parent_name.localeCompare(right.parent_name, "fr"));

  const juniors = Array.from(playerIds).map((id) => {
    const profile = profiles.get(id);
    const juniorAuth = auth.get(id);
    const guardianLinks = (linksByPlayer.get(id) ?? []).map((link) => {
      const parentAuth = auth.get(link.guardian_user_id);
      return {
        parent_user_id: link.guardian_user_id,
        parent_name: fullName(profiles.get(link.guardian_user_id)),
        parent_email: parentAuth?.email ?? null,
        relation: link.relation,
        is_primary: Boolean(link.is_primary),
      };
    });
    const usableParents = guardianLinks.filter((parent) => Boolean(parent.parent_email));
    const primary = usableParents.find((parent) => parent.is_primary);
    const directEmail = juniorAuth?.email ?? null;
    const selected = directEmail ? null : primary ?? (usableParents.length === 1 ? usableParents[0] : null);
    const recipientKind = directEmail ? "junior" : selected ? "parent" : usableParents.length > 1 ? "selection_required" : "missing";
    const recipientId = directEmail ? id : selected?.parent_user_id ?? null;
    const recipientEmail = directEmail ?? selected?.parent_email ?? null;
    const log = latestLog(invitationLogs, "junior_access", id, recipientId ?? undefined);
    const sentExpired = log?.last_sent_at && Date.now() - new Date(log.last_sent_at).getTime() > 7 * 86400000 ? log.last_sent_at : null;
    return {
      junior_user_id: id,
      junior_name: fullName(profile),
      junior_username: profile?.username ?? null,
      junior_email: directEmail,
      parents: guardianLinks,
      recipient_kind: recipientKind,
      recipient_user_id: recipientId,
      recipient_name: directEmail ? fullName(profile) : selected?.parent_name ?? null,
      recipient_email: recipientEmail,
      junior_status: accessStatus({ email: recipientEmail, username: profile?.username ?? null, activatedAt: juniorAuth?.last_sign_in_at ?? null, log, expiresAt: sentExpired }),
      junior_last_sent_at: log?.last_sent_at ?? null,
      junior_last_activity_at: juniorAuth?.last_sign_in_at ?? null,
      junior_send_count: Number(log?.send_count ?? 0),
    };
  }).sort((left, right) => left.junior_name.localeCompare(right.junior_name, "fr"));

  return { club: { id: clubId, name: String(club.data?.name ?? "Club") }, parents, juniors, mail_config: await loadFamilyMailConfig(db, clubId) };
}

function html(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;color:#132018;line-height:1.55">${escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#166534">$1</a>').replace(/\n/g, "<br>")}</div>`;
}

async function sendEmail(args: { toEmail: string; toName: string; subject: string; body: string }) {
  const from = String(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>");
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { name: "ActiviTee", email: from };
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": mustEnv("BREVO_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ sender, to: [{ email: args.toEmail, name: args.toName }], subject: args.subject, textContent: args.body, htmlContent: html(args.body) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.message ?? "Échec de l’envoi"));
}

async function logSend(db: any, args: { clubId: string; recipientId: string; targetId: string; kind: InvitationKind; email: string; callerId: string; error?: string | null }) {
  const existing = await db.from("access_invitation_logs").select("id,send_count").eq("club_id", args.clubId).eq("recipient_user_id", args.recipientId).eq("target_user_id", args.targetId).eq("invitation_kind", args.kind).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const values = { sent_to_email: args.email, sent_by: args.callerId, last_sent_at: new Date().toISOString(), send_count: Number(existing.data?.send_count ?? 0) + 1, last_error: args.error ?? null, updated_at: new Date().toISOString() };
  const response = existing.data?.id
    ? await db.from("access_invitation_logs").update(values).eq("id", existing.data.id)
    : await db.from("access_invitation_logs").insert({ club_id: args.clubId, recipient_user_id: args.recipientId, target_user_id: args.targetId, invitation_kind: args.kind, ...values });
  if (response.error) throw new Error(response.error.message);
}

async function parentToken(db: any, args: { clubId: string; parentId: string; email: string; callerId: string }) {
  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  await db.from("access_invitation_tokens").delete().eq("club_id", args.clubId).eq("user_id", args.parentId).eq("invitation_kind", "parent_access").is("consumed_at", null);
  const response = await db.from("access_invitation_tokens").insert({ club_id: args.clubId, user_id: args.parentId, invitation_kind: "parent_access", sent_to_email: args.email, token_hash: hash, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), sent_by: args.callerId });
  if (response.error) throw new Error(response.error.message);
  return raw;
}

async function sendOne(db: any, clubId: string, callerId: string, payload: any, requireReady = false) {
  const dataset = await loadDataset(db, clubId);
  const kind = String(payload?.kind ?? "") as InvitationKind;
  if (kind === "parent_access") {
    const parent = dataset.parents.find((row) => row.parent_user_id === String(payload.parent_user_id ?? ""));
    if (!parent || !parent.parent_email || !parent.parent_username) throw new Error("Informations parent incomplètes");
    if (requireReady && parent.parent_status !== "ready") throw new Error("Invitation parent ignorée : l’état n’est pas prêt");
    const token = await parentToken(db, { clubId, parentId: parent.parent_user_id, email: parent.parent_email, callerId });
    const variables = { club_name: dataset.club.name, parent_name: parent.parent_name, parent_username: parent.parent_username, parent_username_or_existing: parent.parent_username, reset_url: `${appBaseUrl()}/reset-password?invite_token=${encodeURIComponent(token)}`, app_url: `${appBaseUrl()}/`, player_guide_url: PLAYER_GUIDE_URL };
    const subject = renderFamilyTemplate(dataset.mail_config.parent_subject, variables);
    const body = renderFamilyTemplate(dataset.mail_config.parent_body, variables);
    try {
      await sendEmail({ toEmail: parent.parent_email, toName: parent.parent_name, subject, body });
      await logSend(db, { clubId, recipientId: parent.parent_user_id, targetId: parent.parent_user_id, kind, email: parent.parent_email, callerId });
    } catch (error) {
      await logSend(db, { clubId, recipientId: parent.parent_user_id, targetId: parent.parent_user_id, kind, email: parent.parent_email, callerId, error: error instanceof Error ? error.message : "Échec de l’envoi" });
      throw error;
    }
    return;
  }
  if (kind !== "junior_access") throw new Error("Type d’invitation invalide");
  const junior = dataset.juniors.find((row) => row.junior_user_id === String(payload.junior_user_id ?? ""));
  if (!junior) throw new Error("Junior introuvable");
  const requestedRecipientId = String(payload.recipient_user_id ?? junior.recipient_user_id ?? "");
  const linkedRecipient = junior.parents.find((parent) => parent.parent_user_id === requestedRecipientId && parent.parent_email);
  const direct = Boolean(junior.junior_email);
  const recipientId = direct ? junior.junior_user_id : linkedRecipient?.parent_user_id;
  const recipientEmail = direct ? junior.junior_email : linkedRecipient?.parent_email;
  const recipientName = direct ? junior.junior_name : linkedRecipient?.parent_name;
  if (!recipientId || !recipientEmail || !recipientName || !junior.junior_username) throw new Error("Informations d’accès à compléter");
  const becomesReadyAfterSelection = junior.junior_status === "not_ready" && !direct && Boolean(linkedRecipient);
  if (requireReady && junior.junior_status !== "ready" && !becomesReadyAfterSelection) throw new Error("Accès junior ignoré : l’état n’est pas prêt");
  const password = randomPassword();
  const update = await db.auth.admin.updateUserById(junior.junior_user_id, { password });
  if (update.error) throw new Error(update.error.message);
  const variables = { club_name: dataset.club.name, parent_name: linkedRecipient?.parent_name ?? "", junior_name: junior.junior_name, junior_username: junior.junior_username, temp_password: password, app_url: `${appBaseUrl()}/`, player_guide_url: PLAYER_GUIDE_URL };
  const subjectTemplate = direct ? dataset.mail_config.junior_direct_subject : dataset.mail_config.junior_parent_subject;
  const bodyTemplate = direct ? dataset.mail_config.junior_direct_body : dataset.mail_config.junior_parent_body;
  try {
    await sendEmail({ toEmail: recipientEmail, toName: recipientName, subject: renderFamilyTemplate(subjectTemplate, variables), body: renderFamilyTemplate(bodyTemplate, variables) });
    await logSend(db, { clubId, recipientId, targetId: junior.junior_user_id, kind, email: recipientEmail, callerId });
  } catch (error) {
    await logSend(db, { clubId, recipientId, targetId: junior.junior_user_id, kind, email: recipientEmail, callerId, error: error instanceof Error ? error.message : "Échec de l’envoi" });
    throw error;
  }
}

function database() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = database();
    const auth = await authorize(req, db, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json(await loadDataset(db, clubId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = database();
    const auth = await authorize(req, db, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [body];
    if (items.length > 100) return NextResponse.json({ error: "Maximum 100 envois par lot" }, { status: 400 });
    const summary = { sent: 0, skipped: 0, errors: [] as Array<{ index: number; error: string }> };
    for (let index = 0; index < items.length; index += 1) {
      try {
        await sendOne(db, clubId, auth.callerId, items[index], items.length > 1);
        summary.sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Envoi impossible";
        if (/incomplètes|compléter|introuvable|ignoré/i.test(message)) summary.skipped += 1;
        else summary.errors.push({ index, error: message });
      }
    }
    return NextResponse.json({ ok: summary.errors.length === 0, summary }, { status: summary.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = database();
    const auth = await authorize(req, db, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => ({}));
    const defaults = defaultFamilyMailConfig();
    const value = (key: keyof FamilyMailConfig) => String(body[key] ?? "").trim() || defaults[key];
    const config: FamilyMailConfig = {
      parent_subject: value("parent_subject"), parent_body: value("parent_body"),
      junior_direct_subject: value("junior_direct_subject"), junior_direct_body: value("junior_direct_body"),
      junior_parent_subject: value("junior_parent_subject"), junior_parent_body: value("junior_parent_body"),
      consent_subject: value("consent_subject"), consent_body: value("consent_body"),
      periodic_report_subject: value("periodic_report_subject"), periodic_report_body: value("periodic_report_body"),
    };
    const response = await db.from("club_access_invitation_mail_configs").upsert({ club_id: clubId, parent_subject: config.parent_subject, parent_body: config.parent_body, junior_subject: config.junior_parent_subject, junior_body: config.junior_parent_body, ...config, updated_at: new Date().toISOString() }, { onConflict: "club_id" });
    if (response.error) return NextResponse.json({ error: response.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, mail_config: config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
