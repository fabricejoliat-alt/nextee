import { NextResponse, type NextRequest } from "next/server";

type ParentItem = { first_name: string; last_name: string; email: string };
type ChildItem = { first_name: string; last_name: string; birth_date: string; handicap?: string | null };

function cleanString(v: unknown) {
  return String(v ?? "").trim();
}

function formatBody(parents: ParentItem[], children: ChildItem[], notes: string | null) {
  const parentsTxt = parents
    .map((p, idx) => `${idx + 1}. ${p.first_name} ${p.last_name} <${p.email}>`)
    .join("\n");

  const childrenTxt = children
    .map((c, idx) => `${idx + 1}. ${c.first_name} ${c.last_name} | Naissance: ${c.birth_date} | Handicap: ${c.handicap || "non renseigné"}`)
    .join("\n");

  return [
    "NOUVELLE DEMANDE LIAISON PARENTS / JUNIORS",
    "",
    "Parents / représentants légaux:",
    parentsTxt,
    "",
    "Juniors:",
    childrenTxt,
    "",
    `Notes: ${notes || "-"}`,
  ].join("\n");
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const parentsRaw = Array.isArray(body?.parents) ? (body.parents as any[]) : [];
    const childrenRaw = Array.isArray(body?.children) ? (body.children as any[]) : [];

    const parents: ParentItem[] = parentsRaw
      .map((p) => ({
        first_name: cleanString(p?.first_name),
        last_name: cleanString(p?.last_name),
        email: cleanString(p?.email).toLowerCase(),
      }))
      .filter((p) => p.first_name && p.last_name && p.email.includes("@"));

    const uniqueParentEmails = new Set(parents.map((p) => p.email));
    if (uniqueParentEmails.size !== parents.length) {
      return NextResponse.json({ error: "Les adresses e-mail des parents doivent être différentes" }, { status: 400 });
    }

    const children: ChildItem[] = childrenRaw
      .map((c) => ({
        first_name: cleanString(c?.first_name),
        last_name: cleanString(c?.last_name),
        birth_date: cleanString(c?.birth_date),
        handicap: cleanString(c?.handicap) || null,
      }))
      .filter((c) => c.first_name && c.last_name && c.birth_date);

    if (parents.length < 1 || children.length < 1) {
      return NextResponse.json({ error: "Formulaire incomplet" }, { status: 400 });
    }

    const brevoApiKey = process.env.BREVO_API_KEY;
    const from = process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>";
    if (!brevoApiKey) {
      return NextResponse.json(
        { error: "Email provider not configured (missing BREVO_API_KEY)" },
        { status: 500 }
      );
    }

    const text = formatBody(parents, children, cleanString(body?.notes) || null);
    const html = `<pre style=\"font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap\">${text.replace(/</g, "&lt;")}</pre>`;

    const sender = parseMailFrom(from);
    const sendRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: "info@activitee.golf" }],
        subject: "[ActiviTee] Nouveau formulaire parents/juniors",
        textContent: text,
        htmlContent: html,
      }),
    });

    const sendJson = await sendRes.json().catch(() => ({} as any));
    if (!sendRes.ok) {
      return NextResponse.json({ error: String(sendJson?.message ?? "Email send failed") }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
