import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function parseMailFrom(raw: string) {
  const value = String(raw ?? "").trim();
  const match = value.match(/^(.*)<([^>]+)>$/);
  if (!match) return { email: value || "noreply@activitee.golf", name: "ActiviTee" };
  return { name: match[1].trim().replace(/^"|"$/g, "") || "ActiviTee", email: match[2].trim() };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const firstName = clean(body?.first_name);
    const lastName = clean(body?.last_name);
    const birthDate = clean(body?.birth_date);
    const club = clean(body?.club);

    if (!firstName || !lastName || !birthDate || !club) {
      return NextResponse.json({ error: "Formulaire incomplet" }, { status: 400 });
    }

    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
      return NextResponse.json({ error: "Email provider not configured (missing BREVO_API_KEY)" }, { status: 500 });
    }

    const text = [
      "Demande d'aide pour retrouver un username",
      "",
      `Prénom: ${firstName}`,
      `Nom: ${lastName}`,
      `Date de naissance: ${birthDate}`,
      `Club: ${club}`,
      "",
      `Origine: ${req.nextUrl.origin}`,
    ].join("\n");

    const html = [
      "<p>Demande d'aide pour retrouver un username</p>",
      `<p><strong>Prénom:</strong> ${escapeHtml(firstName)}<br />`,
      `<strong>Nom:</strong> ${escapeHtml(lastName)}<br />`,
      `<strong>Date de naissance:</strong> ${escapeHtml(birthDate)}<br />`,
      `<strong>Club:</strong> ${escapeHtml(club)}<br />`,
      `<strong>Origine:</strong> ${escapeHtml(req.nextUrl.origin)}</p>`,
    ].join("");

    const sendRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: parseMailFrom(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>"),
        to: [{ email: "info@activitee.golf", name: "ActiviTee" }],
        subject: "[ActiviTee] Demande de récupération username",
        textContent: text,
        htmlContent: html,
      }),
    });

    const sendJson = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) {
      return NextResponse.json({ error: String(sendJson?.message ?? "Email send failed") }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

