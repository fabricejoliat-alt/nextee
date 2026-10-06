import { NextResponse } from "next/server";
import { publicContactEmail } from "@/lib/server/publicContact";

export const runtime = "nodejs";
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const noStore = { "Cache-Control": "no-store, max-age=0" };
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: noStore });

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function parseSender(raw: string) {
  const match = raw.trim().match(/^(.*)<([^>]+)>$/);
  return match ? { name: match[1].trim().replace(/^"|"$/g, "") || "ActiviTee", email: match[2].trim() }
    : { name: "ActiviTee", email: raw.trim() };
}

export async function POST(req: Request) {
  try {
    if (!req.headers.get("content-type")?.includes("application/json")) return reply({ error: "Format invalide." }, 415);
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return reply({ error: "Origine invalide." }, 403);
    if (Number(req.headers.get("content-length") ?? 0) > 10_000) return reply({ error: "Message trop long." }, 413);
    const raw = await req.text();
    if (raw.length > 10_000) return reply({ error: "Message trop long." }, 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw) as Record<string, unknown>; }
    catch { return reply({ error: "Format invalide." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply({ error: "Format invalide." }, 400);
    const name = String(input.name ?? "").trim().replace(/[\r\n\t]/g, " ");
    const email = String(input.email ?? "").trim().toLowerCase();
    const subject = String(input.subject ?? "").trim().replace(/[\r\n\t]/g, " ");
    const message = String(input.message ?? "").trim();
    const honeypot = String(input.website ?? "").trim();
    const token = String(input.turnstile_token ?? "").trim();
    if (honeypot) return reply({ ok: true }, 202);
    if (name.length < 2 || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || subject.length < 3 || subject.length > 160 || message.length < 10 || message.length > 4000)
      return reply({ error: "Vérifiez les champs du formulaire." }, 400);
    if (!token || token.length > 2048) return reply({ error: "Terminez la vérification anti-spam." }, 400);

    const isProduction = process.env.NODE_ENV === "production";
    const configuredSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const secret = process.env.TURNSTILE_SECRET_KEY || (!isProduction && !configuredSiteKey ? TEST_SECRET_KEY : "");
    if (!secret || (isProduction && (!configuredSiteKey || secret === TEST_SECRET_KEY || configuredSiteKey === TEST_SITE_KEY)))
      return reply({ error: "Formulaire temporairement indisponible." }, 503);
    const brevoKey = process.env.BREVO_API_KEY;
    if (isProduction && !brevoKey) return reply({ error: "Formulaire temporairement indisponible." }, 503);

    const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ secret, response: token }),
    });
    if (!check.ok) return reply({ error: "Vérification anti-spam indisponible. Réessayez." }, 503);
    const validation = await check.json() as { success?: boolean; action?: string; hostname?: string };
    const testMode = !isProduction && secret === TEST_SECRET_KEY;
    const expectedHost = new URL(req.url).hostname;
    if (!validation.success || (!testMode && (validation.action !== "contact" || validation.hostname !== expectedHost)))
      return reply({ error: "Vérification anti-spam échouée. Réessayez." }, 403);

    if (!isProduction && process.env.CONTACT_MAIL_TRANSPORT !== "brevo") return reply({ ok: true, mode: "mock" }, 202);
    if (!brevoKey) return reply({ error: "Formulaire temporairement indisponible." }, 503);
    const recipient = await publicContactEmail();
    const safeName = escapeHtml(name); const safeEmail = escapeHtml(email); const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br />");
    const textContent = ["Nouveau message depuis le formulaire ActiviTee", "", `Nom : ${name}`, `E-mail : ${email}`,
      `Objet : ${subject}`, "", message].join("\n");
    const htmlContent = `<p>Nouveau message depuis le formulaire ActiviTee</p><p><strong>Nom :</strong> ${safeName}<br /><strong>E-mail :</strong> ${safeEmail}<br /><strong>Objet :</strong> ${safeSubject}</p><p>${safeMessage}</p>`;
    const sent = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": brevoKey, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ sender: parseSender(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>"),
        to: [{ email: recipient, name: "ActiviTee" }], replyTo: { email, name },
        subject: `[ActiviTee] Contact : ${subject}`, textContent, htmlContent }),
    });
    if (!sent.ok) return reply({ error: "Envoi impossible. Réessayez plus tard." }, 502);
    return reply({ ok: true, mode: "brevo" }, 201);
  } catch { return reply({ error: "Envoi impossible. Réessayez plus tard." }, 503); }
}
