import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWebPush } from "@/lib/server/webPush";

/** The database atomically stores messages, notification recipients and pending work.
 * Claims prevent the request and scheduled recovery from sending the same push. */
export async function processMarketplaceMessagePushes(db: SupabaseClient, messageId?: string) {
  const claimed = await db.rpc("claim_marketplace_message_pushes", { p_message_id: messageId ?? null, p_limit: 4 });
  if (claimed.error) throw new Error("Marketplace notification queue unavailable");
  let processed = 0, failed = 0;
  type Delivery = { id: string; sender_id: string; actor_id: string | null; recipient_id: string; club_id: string;
    notification_id: string; notification: { title: string; body: string; data?: { url?: string } } | null };
  await Promise.all(((claimed.data ?? []) as Delivery[]).map(async delivery => {
    let status = "skipped", result: Record<string, unknown> = {};
    try {
      const current = await db.from("marketplace_contact_messages").select("recipient_deleted_at")
        .eq("id", delivery.id).maybeSingle();
      if (current.error) throw current.error;
      if (current.data && !current.data.recipient_deleted_at && delivery.notification) {
        const recipients = await db.from("notification_recipients").select("user_id")
          .eq("notification_id", delivery.notification_id).eq("is_deleted", false);
        if (recipients.error) throw recipients.error;
        const checks = await Promise.all((recipients.data ?? []).map(async row => {
          const [visible, blocked, actorBlocked] = await Promise.all([
            db.rpc("organization_notification_visible", { p_notification: delivery.notification_id, p_actor: row.user_id }),
            db.rpc("marketplace_pair_blocked", { p_actor: row.user_id, p_subject: delivery.recipient_id,
              p_other: delivery.sender_id, p_club: delivery.club_id }),
            db.rpc("marketplace_pair_blocked", { p_actor: row.user_id, p_subject: delivery.recipient_id,
              p_other: delivery.actor_id ?? delivery.sender_id, p_club: delivery.club_id }),
          ]);
          if (visible.error || blocked.error || actorBlocked.error) throw new Error("Marketplace notification access unavailable");
          return visible.data === true && blocked.data === false && actorBlocked.data === false ? row.user_id : null;
        }));
        const targets = checks.filter((id): id is string => Boolean(id));
        const push = await sendWebPush(db, { recipientUserIds: targets, kind: "marketplace_message",
          title: delivery.notification.title, body: delivery.notification.body,
          url: delivery.notification.data?.url, templateKey: "notif.marketplaceMessage", templateParams: {} });
        status = push.failed ? "failed" : push.configured ? "completed" : "skipped";
        result = { ...push };
      }
    } catch {
      status = "failed"; result = { error: "Marketplace push unavailable" };
    }
    const saved = await db.from("marketplace_contact_messages").update({ push_status: status, push_result: result })
      .eq("id", delivery.id).eq("push_status", "processing");
    if (saved.error) throw new Error("Marketplace push outcome unavailable");
    processed++; if (status === "failed") failed++;
  }));
  return { processed, failed };
}
