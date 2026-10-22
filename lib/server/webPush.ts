import { serverNotificationMessage, type NotificationTemplateInput } from "@/lib/server/notificationTemplates";
import type { NotificationLocale } from "@/lib/notificationCatalog";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { loadNotificationBadgeCounts } from "@/lib/notificationBadgeCounts";
import { apnsConfigured, apnsPayload, openApnsConnection, sendApns, type NativePushDevice } from "@/lib/server/apns";
import { fcmConfigured, fcmMessage, sendFcm, type AndroidPushDevice } from "@/lib/server/fcm";

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
  nativeDevice?: NativePushDevice;
  androidDevice?: AndroidPushDevice;
} & NotificationTemplateInput) {
  const webEnabled = webPushConfigured() && !input.nativeDevice && !input.androidDevice;
  const nativeEnabled = apnsConfigured(input.nativeDevice?.environment) && !input.endpoint && !input.androidDevice;
  const androidEnabled = fcmConfigured() && !input.endpoint && !input.nativeDevice;
  const result = { configured: webEnabled || nativeEnabled || androidEnabled, attempted: 0, sent: 0, failed: 0, cleaned: 0 };
  if (!result.configured || !input.recipientUserIds.length) return result;
  const preferences = await db.from("user_notification_preferences").select("user_id,receive_in_app,receive_push,enabled_kinds")
    .in("user_id", [...new Set(input.recipientUserIds)]);
  if (preferences.error) throw new Error("Push preferences unavailable");
  const allowed = (preferences.data ?? []).filter(row => row.receive_push === true && row.receive_in_app !== false &&
    (input.test || !row.enabled_kinds?.length || row.enabled_kinds.includes(input.kind))).map(row => row.user_id);
  if (!allowed.length) return result;
  let query = db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,locale").in("user_id", allowed);
  if (input.endpoint) query = query.eq("endpoint", input.endpoint);
  const subscriptions = webEnabled ? await query : { data: [], error: null };
  if (subscriptions.error) throw new Error("Push subscriptions unavailable");
  if (webEnabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@activitee.app",
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
  if (nativeEnabled) {
    let nativeQuery = db.from("native_push_subscriptions").select("id,user_id,device_token,environment,bundle_id,locale,updated_at").in("user_id", allowed);
    if (input.nativeDevice) nativeQuery = nativeQuery.eq("device_token", input.nativeDevice.token.toLowerCase())
      .eq("environment", input.nativeDevice.environment).eq("bundle_id", input.nativeDevice.bundleId);
    const devices = await nativeQuery;
    if (devices.error) throw new Error("Native push subscriptions unavailable");
    // Count per account, not per message/thread or once for every recipient.
    // A counter outage must not prevent the notification itself from arriving.
    const badgeCounts = await loadNotificationBadgeCounts(db, (devices.data ?? []).map(row => row.user_id))
      .catch(() => { console.warn("Notification badge count unavailable"); return new Map<string, number>(); });
    for (const environment of ["sandbox", "production"] as const) {
      const rows = (devices.data ?? []).filter(row => row.environment === environment);
      if (!rows.length) continue;
      if (!apnsConfigured(environment)) { result.failed += rows.length; continue; }
      const client = openApnsConnection(environment);
      try {
        // Keep each connection's number of concurrent streams bounded.
        for (let offset = 0; offset < rows.length; offset += 20) {
          await Promise.all(rows.slice(offset, offset + 20).map(async row => {
            result.attempted++;
            try {
              const locale = (["fr", "en", "de", "it"].includes(row.locale) ? row.locale : "fr") as NotificationLocale;
              const message = input.templateKey
                ? await serverNotificationMessage(db, input.templateKey, locale, input.templateParamsByLocale?.[locale] ?? input.templateParams ?? {})
                : { title: input.title, body: input.body ?? "" };
              const delivery = await sendApns(client, { token: row.device_token, environment, bundleId: row.bundle_id },
                apnsPayload({ ...message, url: notificationPath(input.url), recipientUserId: row.user_id, badgeCount: badgeCounts.get(row.user_id) }));
              if (delivery.sent) result.sent++; else result.failed++;
              if (delivery.stale) {
                // Do not delete a token that was refreshed while the provider answered.
                const removed = await db.from("native_push_subscriptions").delete().eq("id", row.id).eq("updated_at", row.updated_at);
                if (!removed.error) result.cleaned++;
              }
            } catch { result.failed++; }
          }));
        }
      } finally { client.close(); }
    }
  }
  if (androidEnabled) {
    let query = db.from("android_push_subscriptions").select("id,user_id,device_token,application_id,locale,updated_at").in("user_id", allowed);
    if (input.androidDevice) query = query.eq("device_token", input.androidDevice.token).eq("application_id", input.androidDevice.applicationId);
    const devices = await query;
    if (devices.error) throw new Error("Android push subscriptions unavailable");
    const badgeCounts = await loadNotificationBadgeCounts(db, (devices.data ?? []).map(row => row.user_id))
      .catch(() => new Map<string, number>());
    for (let offset = 0; offset < (devices.data ?? []).length; offset += 20) {
      await Promise.all((devices.data ?? []).slice(offset, offset + 20).map(async row => {
        result.attempted++;
        try {
          const locale = (["fr", "en", "de", "it"].includes(row.locale) ? row.locale : "fr") as NotificationLocale;
          const message = input.templateKey
            ? await serverNotificationMessage(db, input.templateKey, locale, input.templateParamsByLocale?.[locale] ?? input.templateParams ?? {})
            : { title: input.title, body: input.body ?? "" };
          const delivery = await sendFcm({ token: row.device_token, applicationId: row.application_id },
            fcmMessage({ ...message, url: notificationPath(input.url), recipientUserId: row.user_id, badgeCount: badgeCounts.get(row.user_id) }));
          if (delivery.sent) result.sent++; else result.failed++;
          if (delivery.stale) {
            const removed = await db.from("android_push_subscriptions").delete().eq("id", row.id).eq("updated_at", row.updated_at);
            if (!removed.error) result.cleaned++;
          }
        } catch { result.failed++; }
      }));
    }
  }
  return result;
}
