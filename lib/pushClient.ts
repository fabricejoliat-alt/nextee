import { supabase } from "@/lib/supabaseClient";

function base64UrlToUint8Array(base64Url: string) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export function supportsWebPush() {
  if (typeof window === "undefined" || isNativeApp()) return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushFailureMessage(reason: string) {
  return ({ denied: "notifications.settings.pushDenied", not_granted: "notifications.settings.pushNotGranted",
    missing_vapid: "notifications.settings.pushNotConfigured", worker_error: "notifications.settings.pushWorkerError",
    native: "notifications.settings.nativePush", unsupported: "notifications.settings.unsupported",
    no_session: "notifications.settings.pushSessionExpired" } as Record<string, string>)[reason] ?? "notifications.settings.pushError";
}

export function isNativeApp() {
  return typeof window !== "undefined" && Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

async function activePushWorker() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Push worker unavailable")), 10000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function hasLocalPushSubscription() {
  if (!supportsWebPush()) return false;
  const reg = await activePushWorker();
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function ensurePushSubscription(options?: { prompt?: boolean }) {
  if (isNativeApp()) return { ok: false as const, reason: "native" as const };
  if (!supportsWebPush()) return { ok: false as const, reason: "unsupported" as const };
  if (typeof Notification === "undefined") return { ok: false as const, reason: "unsupported" as const };

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return { ok: false as const, reason: "missing_vapid" as const };

  const permission = Notification.permission;
  if (permission === "denied") return { ok: false as const, reason: "denied" as const };

  let finalPermission: NotificationPermission = permission;
  if (permission === "default" && options?.prompt) {
    finalPermission = await Notification.requestPermission();
  }
  if (finalPermission !== "granted") return { ok: false as const, reason: "not_granted" as const };

  let reg: ServiceWorkerRegistration;
  try { reg = await activePushWorker(); }
  catch { return { ok: false as const, reason: "worker_error" as const }; }
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
    }));

  const headers = await authHeader();
  if (!headers) return { ok: false as const, reason: "no_session" as const };

  const res = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });

  if (!res.ok) return { ok: false as const, reason: "api_error" as const };
  return { ok: true as const };
}

export async function disablePushSubscription() {
  if (!supportsWebPush()) return { ok: true as const };

  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { ok: true as const };
  const headers = await authHeader();
  if (!headers) return { ok: false as const, reason: "no_session" as const };
  const res = await fetch("/api/push/subscriptions", {
    method: "DELETE", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  if (!res.ok) return { ok: false as const, reason: "api_error" as const };
  const removed = await sub.unsubscribe();
  if (!removed) return { ok: false as const, reason: "api_error" as const };

  return { ok: true as const };
}

export async function dispatchPush(payload: {
  notificationId?: string;
  title: string;
  body?: string | null;
  url?: string;
  badgeCount?: number;
  recipientUserIds: string[];
}) {
  const headers = await authHeader();
  if (!headers) return { ok: false as const, reason: "no_session" as const };

  const res = await fetch("/api/push/dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) return { ok: false as const, reason: "api_error" as const };
  return { ok: true as const };
}

export async function testPushSubscription(locale: string) {
  if (!supportsWebPush()) return { ok: false };
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  const headers = await authHeader();
  if (!sub || !headers) return { ok: false };
  const res = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ endpoint: sub.endpoint, locale }) });
  return { ok: res.ok };
}
