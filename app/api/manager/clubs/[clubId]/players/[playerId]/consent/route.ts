import { NextResponse, type NextRequest } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import { cleanFamilyEmail, defaultFamilyMailConfig, renderFamilyTemplate } from "@/lib/familyAccess";

export const runtime = "nodejs";
type ConsentStatus = "pending" | "granted" | "refused" | "adult";
type ConsentSource = "parent_portal" | "manager" | "import";

function mustEnv(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }
function db() { return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); }
async function authorize(req: NextRequest, database: any, clubId: string) { const token = req.headers.get("authorization")?.replace("Bearer ", ""); if (!token) return null; const caller = await database.auth.getUser(token); if (caller.error || !caller.data.user) return null; const callerId = caller.data.user.id; const [admin, member] = await Promise.all([database.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle(), database.from("club_members").select("id").eq("club_id", clubId).eq("user_id", callerId).eq("role", "manager").eq("is_active", true).maybeSingle()]); return admin.data || member.data ? callerId : null; }
function appUrl() { return String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://www.activitee.golf").replace(/\/+$/, ""); }
function name(row: any) { return `${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim() || "Utilisateur"; }

async function load(database: any, clubId: string, playerId: string) {
  const [membership, consent, history, links] = await Promise.all([
    database.from("club_members").select("id,player_consent_status").eq("club_id", clubId).eq("user_id", playerId).eq("role", "player").maybeSingle(),
    database.from("player_consents").select("*").eq("club_id", clubId).eq("player_user_id", playerId).maybeSingle(),
    database.from("player_consent_history").select("*").eq("club_id", clubId).eq("player_user_id", playerId).order("changed_at", { ascending: false }).limit(100),
    database.from("player_guardians").select("guardian_user_id,is_primary,relation").eq("player_id", playerId),
  ]);
  if (membership.error || !membership.data) throw new Error(membership.error?.message ?? "Junior introuvable");
  const consentTableErrors = [consent.error?.message, history.error?.message].filter(Boolean);
  const consentTablesPending = consentTableErrors.length > 0 && consentTableErrors.every((message) => /relation|schema cache/i.test(String(message)));
  if (consent.error && !consentTablesPending) throw new Error(consent.error.message);
  if (history.error && !consentTablesPending) throw new Error(history.error.message);
  if (links.error) throw new Error(links.error.message);
  const guardianIds = (links.data ?? []).map((row: any) => String(row.guardian_user_id));
  const profiles = guardianIds.length ? await database.from("profiles").select("id,first_name,last_name,username").in("id", guardianIds) : { data: [], error: null };
  if (profiles.error) throw new Error(profiles.error.message);
  const authById = new Map<string, string | null>();
  if (guardianIds.length) { const wanted = new Set(guardianIds); for (let page = 1; wanted.size; page += 1) { const result = await database.auth.admin.listUsers({ page, perPage: 1000 }); if (result.error) throw result.error; for (const user of result.data.users ?? []) if (wanted.has(user.id)) { authById.set(user.id, cleanFamilyEmail(user.email)); wanted.delete(user.id); } if ((result.data.users ?? []).length < 1000) break; } }
  const profileById = new Map((profiles.data ?? []).map((row: any) => [String(row.id), row]));
  const guardians = (links.data ?? []).map((link: any) => ({ guardian_user_id: String(link.guardian_user_id), guardian_name: name(profileById.get(String(link.guardian_user_id))), email: authById.get(String(link.guardian_user_id)) ?? null, is_primary: Boolean(link.is_primary), relation: link.relation ?? null }));
  const status = (consent.data?.status ?? membership.data.player_consent_status ?? "pending") as ConsentStatus;
  return { consent: consent.data ?? { club_id: clubId, player_user_id: playerId, status, decided_at: null, signer_guardian_user_id: null, signer_name: null, source: "manager", consent_version: null, internal_notes: null }, history: history.data ?? [], guardians, migration_pending: consentTablesPending };
}

async function sendReminder(database: any, clubId: string, playerId: string, callerId: string) {
  const dataset = await load(database, clubId, playerId);
  if (dataset.consent.status !== "pending") throw new Error("Un rappel n’est possible que pour un consentement à obtenir.");
  const guardian = dataset.guardians.find((row: any) => row.is_primary && row.email) ?? dataset.guardians.find((row: any) => row.email);
  if (!guardian?.email) throw new Error("Aucun parent lié ne possède d’adresse e-mail exploitable.");
  const [club, player, mailConfig] = await Promise.all([
    database.from("clubs").select("name").eq("id", clubId).single(),
    database.from("profiles").select("first_name,last_name").eq("id", playerId).single(),
    database.from("club_access_invitation_mail_configs").select("consent_subject,consent_body").eq("club_id", clubId).maybeSingle(),
  ]);
  if (club.error || player.error || mailConfig.error) throw new Error(club.error?.message ?? player.error?.message ?? mailConfig.error?.message);
  const defaults = defaultFamilyMailConfig(); const base = appUrl(); const variables = { club_name: String(club.data.name ?? "Club"), parent_name: guardian.guardian_name, junior_name: name(player.data), consent_url: `${base}/parent?child=${encodeURIComponent(playerId)}`, app_url: `${base}/` };
  const subject = renderFamilyTemplate(String(mailConfig.data?.consent_subject ?? defaults.consent_subject), variables); const body = renderFamilyTemplate(String(mailConfig.data?.consent_body ?? defaults.consent_body), variables);
  const from = String(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>"); const match = from.match(/^(.+?)\s*<([^>]+)>$/); const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { name: "ActiviTee", email: from };
  let lastError: string | null = null;
  try { const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": mustEnv("BREVO_API_KEY"), "Content-Type": "application/json" }, body: JSON.stringify({ sender, to: [{ email: guardian.email, name: guardian.guardian_name }], subject, textContent: body, htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.55">${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>` }) }); const json = await response.json().catch(() => ({})); if (!response.ok) throw new Error(json.message ?? "Échec de l’envoi"); }
  catch (error) { lastError = error instanceof Error ? error.message : "Échec de l’envoi"; }
  const existing = await database.from("access_invitation_logs").select("id,send_count").eq("club_id", clubId).eq("recipient_user_id", guardian.guardian_user_id).eq("target_user_id", playerId).eq("invitation_kind", "consent_reminder").maybeSingle();
  const values = { sent_to_email: guardian.email, sent_by: callerId, last_sent_at: new Date().toISOString(), send_count: Number(existing.data?.send_count ?? 0) + 1, last_error: lastError, updated_at: new Date().toISOString() };
  const result = existing.data?.id ? await database.from("access_invitation_logs").update(values).eq("id", existing.data.id) : await database.from("access_invitation_logs").insert({ club_id: clubId, recipient_user_id: guardian.guardian_user_id, target_user_id: playerId, invitation_kind: "consent_reminder", ...values });
  if (result.error) throw new Error(result.error.message); if (lastError) throw new Error(lastError);
  return { recipient: guardian.email };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string; playerId: string }> }) { try { const { clubId, playerId } = await ctx.params; const database = db(); if (!(await authorize(req, database, clubId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); return NextResponse.json(await load(database, clubId, playerId)); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); } }

export async function PUT(req: NextRequest, ctx: { params: Promise<{ clubId: string; playerId: string }> }) {
  try { const { clubId, playerId } = await ctx.params; const database = db(); const callerId = await authorize(req, database, clubId); if (!callerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); const body = await req.json(); const status = String(body.status ?? "") as ConsentStatus; const source = String(body.source ?? "manager") as ConsentSource; if (!["pending", "granted", "refused", "adult"].includes(status)) return NextResponse.json({ error: "Statut invalide" }, { status: 400 }); if (!["parent_portal", "manager", "import"].includes(source)) return NextResponse.json({ error: "Origine invalide" }, { status: 400 }); const decidedAt = status === "pending" ? null : (body.decided_at || new Date().toISOString()); const values = { club_id: clubId, player_user_id: playerId, status, decided_at: decidedAt, signer_guardian_user_id: body.signer_guardian_user_id || null, signer_name: String(body.signer_name ?? "").trim() || null, source, consent_version: String(body.consent_version ?? "").trim() || null, internal_notes: String(body.internal_notes ?? "").trim() || null, updated_by: callerId, updated_at: new Date().toISOString() }; const membership = await database.from("club_members").update({ player_consent_status: status }).eq("user_id", playerId).eq("role", "player").eq("is_active", true); if (membership.error) throw new Error(membership.error.message); const consent = await database.from("player_consents").upsert(values, { onConflict: "club_id,player_user_id" }); if (consent.error) throw new Error(consent.error.message); const history = await database.from("player_consent_history").insert({ club_id: clubId, player_user_id: playerId, status, decided_at: decidedAt, signer_guardian_user_id: values.signer_guardian_user_id, signer_name: values.signer_name, source, consent_version: values.consent_version, internal_notes: values.internal_notes, changed_by: callerId }); if (history.error) throw new Error(history.error.message); return NextResponse.json({ ok: true, ...(await load(database, clubId, playerId)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string; playerId: string }> }) { try { const { clubId, playerId } = await ctx.params; const database = db(); const callerId = await authorize(req, database, clubId); if (!callerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); return NextResponse.json({ ok: true, ...(await sendReminder(database, clubId, playerId, callerId)) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 400 }); } }
