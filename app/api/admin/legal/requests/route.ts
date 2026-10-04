import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
export async function GET(req: Request) {
  try { const db = legalDb(); if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const rows = await db.from("legal_data_requests").select("id,requester_id,contact_email,request_kind,description,status,created_at,closed_at")
      .order("created_at", { ascending: false }).limit(100);
    if (rows.error) throw rows.error; return reply({ requests: rows.data });
  } catch { return reply({ error: "Unavailable" }, 503); }
}
export async function PATCH(req: Request) {
  try { const db = legalDb(); const actor = await legalAdmin(req, db); if (!actor) return reply({ error: "Forbidden" }, 403);
    const input = await req.json(); const result = await db.rpc("review_legal_data_request", {
      p_request: String(input.id ?? ""), p_actor: actor.id, p_status: String(input.status ?? ""), p_note: String(input.note ?? "") });
    if (result.error) return reply({ error: result.error.message }, 409); return reply({ ok: true });
  } catch { return reply({ error: "Unavailable" }, 503); }
}
