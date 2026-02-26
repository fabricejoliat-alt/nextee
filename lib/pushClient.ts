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
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function ensurePushSubscription(options?: { prompt?: boolean }) {
  if (!supportsWebPush()) return { ok: false as const, reason: "unsupported" as const };

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return { ok: false as const, reason: "missing_vapid" as const };

  const permission = Notification.permission;
  if (permission === "denied") return { ok: false as const, reason: "denied" as const };

  let finalPermission = permission;
  if (permission === "default" && options?.prompt) {
    finalPermission = await Notification.requestPermission();
  }
  if (finalPermission !== "granted") return { ok: false as const, reason: "not_granted" as const };

  const reg = await navigator.serviceWorker.register("/sw.js");
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

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true as const };

  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});

  const headers = await authHeader();
  if (!headers) return { ok: true as const };

  await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});

  return { ok: true as const };
}

export async function dispatchPush(payload: {
  notificationId?: string;
  title: string;
  body?: string | null;
  url?: string;
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
