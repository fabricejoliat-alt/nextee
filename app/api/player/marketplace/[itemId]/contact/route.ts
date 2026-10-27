import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient, resolveMarketplaceAccess } from "../../_lib";
import { marketplaceContactEmail, marketplaceContactTextAllowed } from "@/lib/marketplaceContact";
import { marketplaceSafetyContext, marketplaceUuid } from "@/lib/server/marketplaceSafety";
import { processMarketplaceMessagePushes } from "@/lib/server/marketplaceMessageNotifications";

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
    if (input.request_id != null && !marketplaceUuid(input.request_id)) return reply({ error: "invalid_message" }, 400);
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
    const stored = await db.rpc("send_marketplace_contact_v2", {
      p_actor: access.viewerUserId, p_subject: access.effectiveUserId, p_item: itemId,
      p_email: email, p_subject_text: subject, p_message: message, p_request_id: input.request_id ?? randomUUID(),
    });
    if (stored.error || !stored.data) return reply({ error: stored.error?.code === "P0001" ? "rate_limited" : "inactive" }, stored.error?.code === "P0001" ? 429 : 409);
    // The message and in-app alert are committed. Provider failure must not invite
    // a duplicate message; scheduled recovery handles unclaimed push work.
    await processMarketplaceMessagePushes(db, stored.data).catch(() => {});
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey || (process.env.NODE_ENV !== "production" && process.env.MARKETPLACE_MAIL_TRANSPORT !== "brevo"))
      return reply({ ok: true, message_id: stored.data, email_sent: false });
    const claimed = await db.from("marketplace_contact_messages").update({ email_claimed_at: new Date().toISOString() })
      .eq("id", stored.data).is("email_claimed_at", null).select("id").maybeSingle();
    if (claimed.error || !claimed.data) return reply({ ok: true, message_id: stored.data });
    const from = process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>";
    const match = from.match(/^(.+?)\s*<([^>]+)>$/);
    const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { name: "ActiviTee", email: from.trim() };
    const link = new URL(`/player/marketplace/${encodeURIComponent(itemId)}`, req.url).toString();
    const safetyLink = new URL(`/player/marketplace/messages?message=${encodeURIComponent(stored.data)}&child_id=${encodeURIComponent(item.data.user_id)}`, req.url).toString();
    const sent = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": apiKey, "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ sender, to: [{ email: recipient }], replyTo: { email },
        subject: `[ActiviTee Marketplace] ${subject}`,
        textContent: [`Annonce : ${item.data.title}`, link, "", message, "", `Adresse de réponse : ${email}`, "", "Consulter le message et répondre dans ActiviTee :", safetyLink].join("\n"),
      }),
    }).catch(() => null);
    await db.from("marketplace_contact_messages").update({ status: sent?.ok ? "sent" : "failed" }).eq("id", stored.data);
    return reply({ ok: true, message_id: stored.data, email_sent: sent?.ok === true });
  } catch { return reply({ error: "send_failed" }, 503); }
}
