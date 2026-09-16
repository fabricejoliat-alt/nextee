import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { cleanFamilyEmail, defaultFamilyMailConfig, renderFamilyTemplate } from "@/lib/familyAccess";
import { nextReportDate, type ReportFrequency } from "@/lib/periodicReports";
import { buildPeriodicReportContent, defaultPeriodicReportSections } from "@/lib/periodicReportContent";

export const runtime = "nodejs";

const defaultSections = defaultPeriodicReportSections;
function validFrequency(value: string): value is ReportFrequency { return ["monthly", "quarterly", "semiannual"].includes(value); }
function appUrl() { return String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, ""); }
async function authorize(db: any, callerId: string, clubId: string, playerId: string) {
  const [admin, manager, player] = await Promise.all([
    db.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", callerId).eq("role", "manager").eq("is_active", true).maybeSingle(),
    db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", playerId).eq("role", "player").eq("is_active", true).maybeSingle(),
  ]);
  if (!player.data) return { ok: false as const, status: 404, error: "Junior introuvable." };
  if (!admin.data && !manager.data) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const };
}
async function authUsers(db: any, ids: string[]) {
  const wanted = new Set(ids); const result = new Map<string, { email: string | null; name: string }>();
  const profiles = ids.length ? await db.from("profiles").select("id,first_name,last_name").in("id", ids) : { data: [], error: null };
  const names = new Map<string, string>((profiles.data ?? []).map((row: any) => [String(row.id), `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Utilisateur"]));
  for (let page = 1; wanted.size && page <= 20; page += 1) {
    const response = await db.auth.admin.listUsers({ page, perPage: 1000 }); if (response.error) throw response.error;
    for (const user of response.data.users) if (wanted.has(user.id)) { result.set(user.id, { email: cleanFamilyEmail(user.email), name: names.get(user.id) ?? "Utilisateur" }); wanted.delete(user.id); }
    if (response.data.users.length < 1000) break;
  }
  return result;
}
async function recipients(db: any, playerId: string) {
  const links = await db.from("player_guardians").select("guardian_user_id,relation,is_primary,can_view").eq("player_id", playerId);
  if (links.error) throw new Error(links.error.message);
  const ids = (links.data ?? []).filter((row: any) => row.can_view !== false).map((row: any) => String(row.guardian_user_id));
  const users = await authUsers(db, ids);
  return (links.data ?? []).map((row: any) => ({ userId: row.guardian_user_id, relation: row.relation, isPrimary: Boolean(row.is_primary), name: users.get(row.guardian_user_id)?.name ?? "Parent", email: users.get(row.guardian_user_id)?.email ?? null })).filter((row: any) => row.email);
}
async function sendEmail(to: { email: string; name: string }, subject: string, body: string) {
  const transport = process.env.PERIODIC_REPORT_TRANSPORT || (process.env.NODE_ENV === "production" ? "brevo" : "mock");
  if (transport === "mock") return `mock-${crypto.randomUUID()}`;
  const from = String(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>"); const match = from.match(/^(.+?)\s*<([^>]+)>$/); const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { name: "ActiviTee", email: from };
  const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": String(process.env.BREVO_API_KEY ?? ""), "Content-Type": "application/json" }, body: JSON.stringify({ sender, to: [{ email: to.email, name: to.name }], subject, textContent: body }) });
  const json = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(json.message ?? "Échec de l’envoi")); return String(json.messageId ?? "brevo");
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string; playerId: string }> }) {
  try { const token = req.headers.get("authorization")?.replace("Bearer ", ""); if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 }); const { clubId, playerId } = await ctx.params; const { supabaseAdmin: db, callerId } = await requireCaller(token); const access = await authorize(db, callerId, clubId, playerId); if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const [config, history, availableRecipients] = await Promise.all([db.from("player_periodic_report_configs").select("*").eq("club_id", clubId).eq("player_user_id", playerId).maybeSingle(), db.from("player_periodic_report_deliveries").select("id,recipient_user_id,period_from,period_to,delivery_mode,status,error_message,attempt_count,sent_at,created_at").eq("club_id", clubId).contains("player_user_ids", [playerId]).order("created_at", { ascending: false }).limit(30), recipients(db, playerId)]);
    if (config.error || history.error) throw new Error(config.error?.message ?? history.error?.message);
    return NextResponse.json({ config: config.data ?? { is_enabled: false, frequency: "monthly", send_day: 5, timezone: "Europe/Zurich", locale: "fr", recipient_user_ids: availableRecipients.filter((row: any) => row.isPrimary).map((row: any) => row.userId), sections: defaultSections, coach_priority: "", coach_objective: "", coach_encouragement: "", coach_comment: "", next_send_at: null, last_sent_at: null, last_status: null }, recipients: availableRecipients, history: history.data ?? [] });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ clubId: string; playerId: string }> }) {
  try { const token = req.headers.get("authorization")?.replace("Bearer ", ""); if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 }); const { clubId, playerId } = await ctx.params; const { supabaseAdmin: db, callerId } = await requireCaller(token); const access = await authorize(db, callerId, clubId, playerId); if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status }); const body = await req.json(); const frequency: ReportFrequency = validFrequency(body.frequency) ? body.frequency : "monthly"; const available = await recipients(db, playerId); const allowed = new Set(available.map((row: any) => row.userId)); const selected = Array.from(new Set((Array.isArray(body.recipient_user_ids) ? body.recipient_user_ids : []).map(String).filter((id: string) => allowed.has(id)))); if (body.is_enabled && selected.length === 0) return NextResponse.json({ error: "Sélectionnez au moins un parent disposant d’une adresse e-mail exploitable." }, { status: 400 }); const payload = { club_id: clubId, player_user_id: playerId, is_enabled: Boolean(body.is_enabled), frequency, send_day: Math.min(28, Math.max(1, Number(body.send_day) || 5)), timezone: String(body.timezone || "Europe/Zurich"), locale: ["fr", "de", "it", "en"].includes(body.locale) ? body.locale : "fr", recipient_user_ids: selected, sections: { ...defaultSections, ...(body.sections ?? {}) }, coach_priority: String(body.coach_priority ?? "").trim() || null, coach_objective: String(body.coach_objective ?? "").trim() || null, coach_encouragement: String(body.coach_encouragement ?? "").trim() || null, coach_comment: String(body.coach_comment ?? "").trim() || null, next_send_at: Boolean(body.is_enabled) ? nextReportDate(frequency, Number(body.send_day) || 5) : null, updated_by: callerId, updated_at: new Date().toISOString(), created_by: callerId };
    const result = await db.from("player_periodic_report_configs").upsert(payload, { onConflict: "club_id,player_user_id" }).select("*").single(); if (result.error) throw new Error(result.error.message); return NextResponse.json({ config: result.data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string; playerId: string }> }) {
  try { const token = req.headers.get("authorization")?.replace("Bearer ", ""); if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 }); const { clubId, playerId } = await ctx.params; const { supabaseAdmin: db, callerId } = await requireCaller(token); const access = await authorize(db, callerId, clubId, playerId); if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status }); const body = await req.json().catch(() => ({})); const action = String(body.action ?? "preview"); if (!["preview", "test", "send"].includes(action)) return NextResponse.json({ error: "Action inconnue." }, { status: 400 }); const configResult = await db.from("player_periodic_report_configs").select("*").eq("club_id", clubId).eq("player_user_id", playerId).maybeSingle(); if (configResult.error) throw new Error(configResult.error.message); const config = configResult.data ?? { frequency: "monthly", locale: "fr", recipient_user_ids: [], sections: defaultSections }; const frequency: ReportFrequency = validFrequency(config.frequency) ? config.frequency : "monthly"; const content = await buildPeriodicReportContent(db, { ...config, club_id: clubId, player_user_id: playerId, frequency, sections: config.sections ?? defaultSections }); if (action === "preview") return NextResponse.json({ preview: content });
    const templateResult = await db.from("club_access_invitation_mail_configs").select("periodic_report_subject,periodic_report_body").eq("club_id", clubId).maybeSingle(); const defaults = defaultFamilyMailConfig(); const subjectTemplate = templateResult.data?.periodic_report_subject ?? defaults.periodic_report_subject; const bodyTemplate = templateResult.data?.periodic_report_body ?? defaults.periodic_report_body;
    const reportResult = await db.from("player_periodic_reports").upsert({ club_id: clubId, player_user_id: playerId, period_from: content.period.from, period_to: content.period.to, period_label: content.periodLabel, statistics_snapshot: content, published_content: content, personalized_comment: config.coach_comment ?? null, generated_by: callerId }, { onConflict: "club_id,player_user_id,period_from,period_to" }).select("id").single(); if (reportResult.error) throw new Error(reportResult.error.message);
    let targets: Array<{ userId: string; email: string; name: string }> = [];
    if (action === "test") { const users = await authUsers(db, [callerId]); const manager = users.get(callerId); if (!manager?.email) return NextResponse.json({ error: "Votre compte manager ne possède pas d’adresse e-mail exploitable." }, { status: 400 }); targets = [{ userId: callerId, ...manager }]; }
    else { const available = await recipients(db, playerId); const selected = new Set((config.recipient_user_ids ?? []).map(String)); targets = available.filter((row: any) => selected.has(row.userId)); if (!targets.length) return NextResponse.json({ error: "Aucun parent destinataire exploitable." }, { status: 400 }); }
    const sent: string[] = []; const errors: Array<{ email: string; error: string }> = [];
    for (const target of targets) { const reportUrl = `${appUrl()}/parent/reports/${reportResult.data.id}`; const variables = { club_name: content.clubName, parent_name: target.name, period_label: content.periodLabel, junior_names: content.playerName, summary: content.summary, report_url: reportUrl }; const subject = renderFamilyTemplate(subjectTemplate, variables); const mailBody = renderFamilyTemplate(bodyTemplate, variables); try { const providerId = await sendEmail(target, subject, mailBody); if (action !== "test") { const delivery = await db.from("player_periodic_report_deliveries").insert({ club_id: clubId, recipient_user_id: target.userId, report_ids: [reportResult.data.id], player_user_ids: [playerId], period_from: content.period.from, period_to: content.period.to, locale: config.locale ?? "fr", delivery_mode: "manual", status: "sent", provider_message_id: providerId, attempt_count: 1, sent_at: new Date().toISOString() }); if (delivery.error) throw new Error(delivery.error.message); } sent.push(target.email); } catch (error) { const message = error instanceof Error ? error.message : "Échec de l’envoi"; errors.push({ email: target.email, error: message }); if (action !== "test") await db.from("player_periodic_report_deliveries").insert({ club_id: clubId, recipient_user_id: target.userId, report_ids: [reportResult.data.id], player_user_ids: [playerId], period_from: content.period.from, period_to: content.period.to, locale: config.locale ?? "fr", delivery_mode: "manual", status: "failed", error_message: message, attempt_count: 1 }); } }
    if (action !== "test") await db.from("player_periodic_report_configs").update({ last_sent_at: sent.length ? new Date().toISOString() : config.last_sent_at ?? null, last_status: errors.length ? "failed" : "sent", updated_at: new Date().toISOString() }).eq("club_id", clubId).eq("player_user_id", playerId);
    return NextResponse.json({ ok: errors.length === 0, sent, errors, test: action === "test", reportId: reportResult.data.id }, { status: sent.length ? 200 : 502 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}
