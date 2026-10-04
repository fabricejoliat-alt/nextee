import { NextResponse } from "next/server";
import { legalActor, legalDb, legalNoStore } from "@/lib/server/legalAccess";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
export async function POST(req: Request) {
  try {
    const db = legalDb(); const actor = await legalActor(req, db);
    const data = await req.json(); const email = String(data.email ?? actor?.email ?? "").trim().toLowerCase();
    const kind = String(data.kind ?? ""); const description = String(data.description ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["access","rectification","erasure","other"].includes(kind)
      || description.length > 2000) return reply({ error: "Invalid request" }, 400);
    const recent = await db.from("legal_data_requests").select("id").eq("contact_email", email)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString()).limit(1);
    if (recent.error) throw recent.error;
    if (recent.data?.length) return reply({ received: true });
    const saved = await db.from("legal_data_requests").insert({ requester_id: actor?.id ?? null,
      contact_email: email, request_kind: kind, description });
    if (saved.error) throw saved.error;
    return reply({ received: true }, 201);
  } catch { return reply({ error: "Request unavailable" }, 503); }
}
