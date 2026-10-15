import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationTemplateInput } from "./notificationTemplates";
import { sendWebPush } from "./webPush";

type Delivery = {
  id: string; user_id: string; news_id: string; notification_id: string; published: boolean;
  notification: { title: string; body: string | null; kind: string; data: Record<string, unknown> };
};

/** A persistent claim prevents a save, cron overlap or retry from sending the same push twice. */
export async function processPlatformNewsPushes(db: SupabaseClient, newsId: string | null = null) {
  const claimed = await db.rpc("claim_platform_news_push_deliveries", { p_news_id: newsId, p_limit: 20 });
  if (claimed.error) throw new Error(claimed.error.message);
  const deliveries = (claimed.data ?? []) as Delivery[];
  const results: Array<{ status: string }> = [];
  for (let offset = 0; offset < deliveries.length; offset += 5) {
    await Promise.all(deliveries.slice(offset, offset + 5).map(async delivery => {
      let status = "failed"; let result: Record<string, unknown>;
      try {
        const [visible, recipient] = await Promise.all([
          db.rpc("organization_notification_visible", { p_notification: delivery.notification_id, p_actor: delivery.user_id }),
          db.from("notification_recipients").select("id").eq("notification_id", delivery.notification_id).eq("user_id", delivery.user_id).eq("is_deleted", false).maybeSingle(),
        ]);
        if (visible.error || recipient.error) throw new Error("Recipient authorization unavailable");
        if (!delivery.published || visible.data !== true || !recipient.data) {
          status = "skipped"; result = { reason: "recipient_or_publication_unavailable" };
        } else {
          const notification = delivery.notification;
          const data = notification.data;
          const template: NotificationTemplateInput = {
            templateKey: String(data.template_key),
            templateParams: data.template_params as NotificationTemplateInput["templateParams"],
            templateParamsByLocale: data.template_params_by_locale as NotificationTemplateInput["templateParamsByLocale"],
          };
          const push = await sendWebPush(db, { ...template, recipientUserIds: [delivery.user_id], kind: notification.kind,
            title: notification.title, body: notification.body, url: String(data.url ?? "/") });
          status = push.configured && push.failed === 0 ? "completed" : "failed";
          result = { ...push };
        }
      } catch (error) {
        result = { error: error instanceof Error ? error.message : "Push unavailable" };
      }
      const saved = await db.from("platform_news_notification_deliveries").update({
        push_status: status, push_result: result, completed_at: new Date().toISOString(),
      }).eq("id", delivery.id).eq("push_status", "processing");
      if (saved.error) throw new Error("Push outcome could not be recorded");
      results.push({ status });
    }));
  }
  return { processed: results.length, failed: results.filter(result => result.status === "failed").length };
}

export async function dispatchPlatformNewsNotifications(db: SupabaseClient, newsId: string) {
  let created = 0;
  try {
    const queued = await db.rpc("enqueue_platform_news_notifications", { p_news_id: newsId });
    if (queued.error) throw new Error(queued.error.message);
    created = Number(queued.data?.created ?? 0);
    const pushed = await processPlatformNewsPushes(db, newsId);
    return { created, ...pushed };
  } catch (error) {
    return { created, processed: 0, failed: 0, error: error instanceof Error ? error.message : "Notification dispatch unavailable" };
  }
}
