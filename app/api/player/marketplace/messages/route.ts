import { createAdminClient, resolveMarketplaceAccess } from "../_lib";
import { marketplaceSafetyContext, marketplaceSafetyHeaders, marketplaceUuid } from "@/lib/server/marketplaceSafety";
import { marketplaceContactTextAllowed } from "@/lib/marketplaceContact";
import { processMarketplaceMessagePushes } from "@/lib/server/marketplaceMessageNotifications";
const reply = (body: object, status = 200) => Response.json(body, { status, headers: marketplaceSafetyHeaders });

export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) return reply({ error: "unauthorized" }, 401);
    const db = createAdminClient(), query = new URL(req.url).searchParams;
    const access = await resolveMarketplaceAccess(db, token, query.get("child_id") ?? "", "view", false);
    if ("error" in access) return reply({ error: "forbidden" }, access.status);
    const sent = query.get("box") === "sent";
    const offset = Number(query.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return reply({ error: "invalid_request" }, 400);
    let messages = db.from("marketplace_contact_messages")
      .select("id,item_id,sender_id,actor_id,recipient_id,subject,message,reply_email,created_at,reply_to_id,club_id")
      .eq(sent ? "sender_id" : "recipient_id", access.effectiveUserId).in("club_id", access.clubIds)
      .is(sent ? "sender_deleted_at" : "recipient_deleted_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 50);
    const messageId = query.get("message");
    if (messageId) {
      if (!marketplaceUuid(messageId)) return reply({ error: "not_found" }, 404);
      messages = messages.eq("id", messageId);
    }
    const result = await messages;
    if (result.error) throw result.error;
    const rows = (result.data ?? []).slice(0, 50);
    const ids = [...new Set(rows.map(row => sent ? row.recipient_id : row.sender_id))];
    const [profiles, members, safety] = await Promise.all([
      ids.length ? db.from("profiles").select("id,first_name,last_name").in("id", ids) : { data: [], error: null },
      ids.length ? db.from("organization_members").select("user_id,organization_id").in("user_id", ids)
        .in("organization_id", access.clubIds).eq("role", "player").eq("is_active", true) : { data: [], error: null },
      marketplaceSafetyContext(db, access),
    ]);
    if (profiles.error || members.error) throw profiles.error || members.error;
    return reply({ can_edit: access.canEdit, has_more: (result.data ?? []).length > 50, messages: rows.map(row => {
      const person = (profiles.data ?? []).find(profile => profile.id === (sent ? row.recipient_id : row.sender_id));
      return { id: row.id, item_id: row.item_id, subject: row.subject, message: row.message,
        reply_email: sent ? "" : row.reply_email, created_at: row.created_at, reply_to_id: row.reply_to_id,
        correspondent: [person?.first_name, person?.last_name].filter(Boolean).join(" "),
        can_reply: !sent && access.canEdit && row.sender_id !== access.effectiveUserId && row.sender_id !== access.viewerUserId
          && (members.data ?? []).some(member => member.user_id === row.sender_id && member.organization_id === row.club_id)
          && safety.canMessage(row.sender_id, row.club_id, row.actor_id) };
    }) });
  } catch { return reply({ error: "unavailable" }, 503); }
}

export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) return reply({ error: "unauthorized" }, 401);
    if (!req.headers.get("content-type")?.includes("application/json")) return reply({ error: "invalid_request" }, 415);
    if (req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin) return reply({ error: "forbidden" }, 403);
    const raw = await req.text();
    if (raw.length > 12000) return reply({ error: "invalid_request" }, 413);
    let input;
    try { input = JSON.parse(raw); } catch { return reply({ error: "invalid_request" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input) || !marketplaceUuid(input.message_id)
      || !["reply", "delete", "restore"].includes(input.action)) return reply({ error: "invalid_request" }, 400);
    const db = createAdminClient();
    const access = await resolveMarketplaceAccess(db, token, String(input.child_id ?? ""), "edit", false);
    if ("error" in access) return reply({ error: "forbidden" }, access.status);
    const original = await db.from("marketplace_contact_messages").select("id,sender_id,recipient_id")
      .eq("id", input.message_id).in("club_id", access.clubIds).maybeSingle();
    if (original.error) throw original.error;
    if (!original.data || ![original.data.sender_id, original.data.recipient_id].includes(access.effectiveUserId))
      return reply({ error: "not_found" }, 404);
    if (input.action !== "reply") {
      const result = await db.rpc("set_marketplace_message_deleted", { p_actor: access.viewerUserId,
        p_subject: access.effectiveUserId, p_message_id: input.message_id, p_deleted: input.action === "delete" });
      if (result.error) return reply({ error: "forbidden" }, result.error.code === "42501" ? 403 : 503);
      return reply({ ok: true });
    }
    if (original.data.recipient_id !== access.effectiveUserId) return reply({ error: "not_found" }, 404);
    const message = typeof input.message === "string" ? input.message.trim() : "";
    if (!marketplaceUuid(input.request_id) || !message || message.length > 4000) return reply({ error: "invalid_message" }, 400);
    if (!marketplaceContactTextAllowed("", message)) return reply({ error: "content_not_allowed" }, 400);
    const result = await db.rpc("reply_marketplace_message", { p_actor: access.viewerUserId, p_subject: access.effectiveUserId,
      p_message_id: input.message_id, p_message: message, p_request_id: input.request_id });
    if (result.error || !result.data) return reply({ error: result.error?.code === "P0001" ? "rate_limited" : "reply_unavailable" }, result.error?.code === "P0001" ? 429 : 409);
    await processMarketplaceMessagePushes(db, result.data).catch(() => {});
    return reply({ ok: true, message_id: result.data });
  } catch { return reply({ error: "unavailable" }, 503); }
}
