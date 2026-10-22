import { createHash, createPrivateKey, sign } from "node:crypto";

export const ANDROID_APPLICATION_ID = "golf.activitee.app";
export type AndroidPushDevice = { token: string; applicationId: string };

export function validAndroidPushDevice(value: unknown): value is AndroidPushDevice {
  if (!value || typeof value !== "object") return false;
  const v = value as AndroidPushDevice;
  return typeof v.token === "string" && /^[A-Za-z0-9:_.-]{32,4096}$/.test(v.token) && v.applicationId === ANDROID_APPLICATION_ID;
}

function credentials() {
  return { project: process.env.FCM_PROJECT_ID, email: process.env.FCM_CLIENT_EMAIL,
    key: process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n") };
}

export function fcmConfigured() {
  const c = credentials();
  return Boolean(c.project && /^[a-z][a-z0-9-]{4,62}$/.test(c.project) && c.email && c.key);
}

let cached: { fingerprint: string; token: string; expires: number } | undefined;
let pending: Promise<string> | undefined;

export async function fcmAuthorization() {
  const { project, email, key } = credentials();
  if (!project || !email || !key || !fcmConfigured()) throw new Error("FCM not configured");
  const fingerprint = createHash("sha256").update(`${project}:${email}:${key}`).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  if (cached?.fingerprint === fingerprint && cached.expires > now + 60) return cached.token;
  if (pending) return pending;
  pending = (async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
    const input = `${header}.${claims}`;
    const privateKey = createPrivateKey(key);
    if (privateKey.asymmetricKeyType !== "rsa") throw new Error("FCM requires an RSA service account key");
    const assertion = `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("FCM authorization unavailable");
    const data = await response.json();
    if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error("FCM authorization unavailable");
    cached = { fingerprint, token: data.access_token, expires: now + Math.min(data.expires_in, 3600) };
    return cached.token;
  })().finally(() => { pending = undefined; });
  return pending;
}

function truncate(value: string, bytes: number) {
  let result = "", length = 0;
  for (const char of value) { length += Buffer.byteLength(char); if (length > bytes) break; result += char; }
  return result;
}

export function fcmMessage(input: { title: string; body: string; url: string; recipientUserId: string; badgeCount?: number }) {
  const message = { notification: { title: truncate(input.title, 200), body: truncate(input.body, 2000) },
    data: { url: Buffer.byteLength(input.url) <= 700 ? input.url : "/", recipientUserId: input.recipientUserId },
    android: { priority: "HIGH", ttl: "3600s", restricted_package_name: ANDROID_APPLICATION_ID,
      notification: { channel_id: "activitee", icon: "ic_stat_notification", color: "#2e483a",
        ...(Number.isFinite(input.badgeCount) ? { notification_count: Math.max(0, Math.floor(input.badgeCount!)) } : {}) } } };
  while (Buffer.byteLength(JSON.stringify(message)) > 3900 && message.notification.body.length) {
    message.notification.body = truncate(message.notification.body, Math.floor(Buffer.byteLength(message.notification.body) / 2));
  }
  return message;
}

export async function sendFcm(device: AndroidPushDevice, message: ReturnType<typeof fcmMessage>) {
  if (!validAndroidPushDevice(device)) return { sent: false, stale: false };
  const authorization = await fcmAuthorization();
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${credentials().project}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${authorization}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { ...message, token: device.token } }), signal: AbortSignal.timeout(10000) });
  if (response.status === 401) cached = undefined;
  if (response.ok) return { sent: true, stale: false };
  const error = await response.json().catch(() => null);
  const stale = response.status === 404 && error?.error?.details?.some((d: { errorCode?: string }) => d.errorCode === "UNREGISTERED") === true;
  return { sent: false, stale };
}
