import type { SupabaseClient } from "@supabase/supabase-js";
import { renderNotificationTemplate, notificationTemplateDefaults, type NotificationLocale, type NotificationParams } from "@/lib/notificationCatalog";
export type NotificationTemplateInput = { templateKey?: string; templateParams?: NotificationParams };
/** No process-wide cache: a saved Admin edit applies to the next delivery. */
export async function serverNotificationMessage(db: SupabaseClient, key: string, locale: NotificationLocale, params: NotificationParams) {
  if (!Object.hasOwn(notificationTemplateDefaults, key)) throw new Error("Unknown notification template");
  const result = await db.from("app_translations").select("key,value").eq("locale", locale).in("key", [`${key}.title`, `${key}.body`]);
  if (result.error) throw new Error("Notification templates unavailable");
  const overrides = Object.fromEntries((result.data ?? []).map(row => [row.key, row.value]));
  return renderNotificationTemplate(key, locale, params, overrides);
}
export function notificationTemplateData(input: NotificationTemplateInput) {
  return input.templateKey ? { template_key: input.templateKey, template_params: input.templateParams ?? {} } : {};
}
