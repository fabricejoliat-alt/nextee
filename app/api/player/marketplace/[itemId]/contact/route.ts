import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, resolveMarketplaceAccess } from "../../_lib";
import { marketplaceContactEmail, marketplaceContactTextAllowed } from "@/lib/marketplaceContact";
import { marketplaceSafetyContext } from "@/lib/server/marketplaceSafety";

export const runtime = "nodejs";
const attempts = new Map<string, number[]>();
const windowMs = 10 * 60 * 1000;
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply({ error: "unauthorized" }, 401);
    if (!req.headers.get("content-type")?.includes("application/json")) return reply({ error: "invalid_message" }, 415);
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return reply({ error: "forbidden" }, 403);
    if (Number(req.headers.get("content-length") ?? 0) > 16000) return reply({ error: "invalid_message" }, 413);
    const raw = await req.text();
    if (raw.length > 16000) return reply({ error: "invalid_message" }, 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return reply({ error: "invalid_message" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply({ error: "invalid_message" }, 400);
    const email = marketplaceContactEmail(input.reply_email);
    const subject = String(input.subject ?? "").trim();
    const message = String(input.message ?? "").trim();
    if (!email || subject.length < 3 || subject.length > 160 || /[\r\n]/.test(subject) || message.length < 10 || message.length > 4000) {
      return reply({ error: "invalid_message" }, 400);
    }
    if (!marketplaceContactTextAllowed(subject, message)) return reply({ error: "content_not_allowed" }, 400);
    const { itemId } = await ctx.params;
    if (!itemId) return reply({ error: "not_found" }, 404);
    const db = createAdminClient();
    const access = await resolveMarketplaceAccess(db, token, String(input.child_id ?? "").trim(), "edit", false);
    if ("error" in access) return reply({ error: "forbidden" }, access.status);
    const item = await db.from("marketplace_items").select("id,title,club_id,user_id,is_active,contact_email,moderation_status").eq("id", itemId).maybeSingle();
    if (item.error) return reply({ error: "unavailable" }, 503);
    if (!item.data || !access.clubIds.includes(String(item.data.club_id ?? ""))) return reply({ error: "not_found" }, 404);
    if (!item.data.is_active) return reply({ error: "inactive" }, 409);
    const safety = await marketplaceSafetyContext(db, access);
    if (!safety.visible(item.data)) return reply({ error: "inactive" }, 409);
    const recipient = marketplaceContactEmail(item.data.contact_email);
    if (!recipient) return reply({ error: "no_email" }, 409);
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey || (process.env.NODE_ENV !== "production" && process.env.MARKETPLACE_MAIL_TRANSPORT !== "brevo")) {
      return reply({ error: "unavailable" }, 503);
    }
    const now = Date.now();
    for (const [key, dates] of attempts) if (!dates.some(date => date > now - windowMs)) attempts.delete(key);
    const recent = (attempts.get(access.viewerUserId) ?? []).filter(date => date > now - windowMs);
    if (recent.length >= 3 || (!attempts.has(access.viewerUserId) && attempts.size >= 5000)) return reply({ error: "rate_limited" }, 429);
    attempts.set(access.viewerUserId, [...recent, now]);
    const stored = await db.rpc("reserve_marketplace_contact", {
      p_actor: access.viewerUserId, p_subject: access.effectiveUserId, p_item: itemId,
      p_email: email, p_subject_text: subject, p_message: message,
    });
    if (stored.error || !stored.data) return reply({ error: stored.error?.code === "P0001" ? "rate_limited" : "inactive" }, stored.error?.code === "P0001" ? 429 : 409);
    const from = process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>";
    const match = from.match(/^(.+?)\s*<([^>]+)>$/);
    const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { name: "ActiviTee", email: from.trim() };
    const link = new URL(`/player/marketplace/${encodeURIComponent(itemId)}`, req.url).toString();
    const safetyLink = new URL(`/player/marketplace/messages?message=${encodeURIComponent(stored.data)}`, req.url).toString();
    const sent = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": apiKey, "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ sender, to: [{ email: recipient }], replyTo: { email },
        subject: `[ActiviTee Marketplace] ${subject}`,
        textContent: [`Annonce : ${item.data.title}`, link, "", message, "", `Adresse de réponse : ${email}`, "", "Consulter, signaler ou bloquer cet expéditeur dans ActiviTee :", safetyLink].join("\n"),
      }),
    });
    const recorded = await db.from("marketplace_contact_messages").update({ status: sent.ok ? "sent" : "failed" }).eq("id", stored.data);
    if (!sent.ok) return reply({ error: "send_failed" }, 502);
    // The message is retained even when the delivery-status update fails.
    if (recorded.error) return reply({ ok: true });
    return reply({ ok: true });
  } catch { return reply({ error: "send_failed" }, 503); }
}
