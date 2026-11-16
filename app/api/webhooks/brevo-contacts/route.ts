import { NextResponse } from "next/server";
import { legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { contactEmailHash, secretMatches, suppressionEvent } from "@/lib/server/brevoContacts";

export const runtime = "nodejs";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("authorization"), process.env.BREVO_CONTACTS_WEBHOOK_SECRET ? `Bearer ${process.env.BREVO_CONTACTS_WEBHOOK_SECRET}` : undefined)) {
    return reply({ error: "Unauthorized" }, 401);
  }
  try {
    // Bound both declared and actual bodies, including requests without Content-Length.
    if (Number(req.headers.get("content-length")) > 65536) return reply({ error: "Payload too large" }, 413);
    const reader = req.body?.getReader();
    if (!reader) return reply({ error: "Invalid payload" }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); return reply({ error: "Payload too large" }, 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return reply({ error: "Invalid payload" }, 400); }
    const events = Array.isArray(body) ? body : [body];
    if (events.length > 100) return reply({ error: "Too many events" }, 400);
    const db = legalDb(); let accepted = 0;
    for (const raw of events) {
      const event = suppressionEvent(raw); if (!event) continue;
      // Permanent suppression contains no name, raw email or campaign payload.
      const saved = await db.rpc("suppress_brevo_contact", { p_email: event.email,
        p_hash: contactEmailHash(event.email), p_reason: event.reason });
      if (saved.error) throw new Error("database");
      accepted++;
    }
    return reply({ accepted });
  } catch { return reply({ error: "Webhook unavailable" }, 503); }
}
