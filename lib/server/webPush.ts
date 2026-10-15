import { serverNotificationMessage, type NotificationTemplateInput } from "@/lib/server/notificationTemplates";
import type { NotificationLocale } from "@/lib/notificationCatalog";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

export function webPushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function validPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"));
  } catch { return false; }
}

export function notificationPath(value: unknown) {
  const path = typeof value === "string" ? value.trim() : "";
  if (path.startsWith("/") && !path.startsWith("//") && !/[\u0000-\u0020\\]/.test(path)) return path;
  try {
    const url = new URL(path);
    if (url.origin === "https://activitee.app") return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* A missing link opens the app. */ }
  return "/";
}

/** Recipient authorization is checked by callers before this delivery helper. */
export async function sendWebPush(db: SupabaseClient, input: {
  recipientUserIds: string[]; kind: string; title: string; body?: string | null; url?: string;
  endpoint?: string; badgeCount?: number; test?: boolean;
} & NotificationTemplateInput) {
  const result = { configured: webPushConfigured(), attempted: 0, sent: 0, failed: 0, cleaned: 0 };
  if (!result.configured || !input.recipientUserIds.length) return result;
  const preferences = await db.from("user_notification_preferences").select("user_id,receive_in_app,receive_push,enabled_kinds")
    .in("user_id", [...new Set(input.recipientUserIds)]);
  if (preferences.error) throw new Error("Push preferences unavailable");
  const allowed = (preferences.data ?? []).filter(row => row.receive_push === true && row.receive_in_app !== false &&
    (input.test || !row.enabled_kinds?.length || row.enabled_kinds.includes(input.kind))).map(row => row.user_id);
  if (!allowed.length) return result;
  let query = db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,locale").in("user_id", allowed);
  if (input.endpoint) query = query.eq("endpoint", input.endpoint);
  const subscriptions = await query;
  if (subscriptions.error) throw new Error("Push subscriptions unavailable");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@activitee.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const localized = new Map<string, { title: string; body: string }>();
  if (input.templateKey) {
    const locales = [...new Set((subscriptions.data ?? []).map(sub => (["fr", "en", "de", "it"].includes(sub.locale) ? sub.locale : "fr") as NotificationLocale))];
    await Promise.all(locales.map(async locale => localized.set(locale,
      await serverNotificationMessage(db, input.templateKey!, locale, input.templateParamsByLocale?.[locale] ?? input.templateParams ?? {}))));
  }
  const stale: number[] = [];
  await Promise.all((subscriptions.data ?? []).map(async sub => {
    result.attempted++;
    if (!validPushEndpoint(sub.endpoint)) { result.failed++; return; }
    try {
      const message = localized.get(sub.locale) ?? localized.get("fr") ?? { title: input.title, body: input.body ?? "" };
      const payload = JSON.stringify({ ...message, url: notificationPath(input.url), icon: "/icon-192.png", badge: "/icon-192.png",
        ...(input.badgeCount != null ? { badgeCount: input.badgeCount } : {}), timestamp: Date.now() });
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
        { TTL: 3600, timeout: 10000, urgency: "normal" });
      result.sent++;
    } catch (error: unknown) {
      result.failed++;
      const status = Number((error as { statusCode?: number })?.statusCode ?? 0);
      if (status === 404 || status === 410) stale.push(sub.id);
    }
  }));
  if (stale.length) {
    const deleted = await db.from("push_subscriptions").delete().in("id", stale);
    if (!deleted.error) result.cleaned = stale.length;
  }
  return result;
}
