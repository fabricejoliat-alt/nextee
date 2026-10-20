import { createAdminClient, resolveMarketplaceAccess } from "../_lib";
import { marketplaceSafetyHeaders, marketplaceUuid } from "@/lib/server/marketplaceSafety";
const reply = (body: object, status = 200) => Response.json(body, { status, headers: marketplaceSafetyHeaders });

export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return reply({ error: "Session invalide." }, 401);
    const db = createAdminClient(), query = new URL(req.url).searchParams;
    const access = await resolveMarketplaceAccess(db, token, query.get("child_id") ?? "", "view", false);
    if ("error" in access) return reply({ error: access.error }, access.status);
    let messages = db.from("marketplace_contact_messages").select("id,subject,message,reply_email,created_at")
      .eq("recipient_id", access.effectiveUserId).in("club_id", access.clubIds).order("created_at", { ascending: false }).limit(100);
    const messageId = query.get("message");
    if (messageId) {
      if (!marketplaceUuid(messageId)) return reply({ error: "Message introuvable." }, 404);
      messages = messages.eq("id", messageId);
    }
    const result = await messages;
    if (result.error) throw result.error;
    return reply({ messages: result.data ?? [] });
  } catch { return reply({ error: "Messages indisponibles." }, 503); }
}
