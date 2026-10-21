import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabaseClient";
import { loadNotificationBadgeCounts } from "@/lib/notificationBadgeCounts";

type Context = { environment: "sandbox" | "production"; bundleId: string };
type Device = Context & { token: string };
const contextPlugin = registerPlugin<{ getContext(): Promise<Context>; setBadgeCount(options: { count: number }): Promise<void> }>("NativePushContext");
let device: Device | null = null;
let pending: Promise<{ ok: boolean; reason?: string }> | null = null;
let generation = 0;
let badgeRevision = 0;
let badgeWrite = Promise.resolve();

function setNativeBadge(count: number) {
  // Serialize native writes so signing out cannot be overtaken by an old count.
  badgeWrite = badgeWrite.catch(() => {}).then(() => contextPlugin.setBadgeCount({ count }));
  return badgeWrite;
}

export async function syncNativeBadge() {
  if (!supportsNativePush()) return;
  const revision = ++badgeRevision;
  const auth = await authorization();
  const counts = auth ? await loadNotificationBadgeCounts(supabase, [auth.userId]) : null;
  const latest = await authorization();
  if (revision !== badgeRevision || latest?.userId !== auth?.userId) return;
  const count = auth ? counts?.get(auth.userId) : 0;
  // Do not turn a failed/missing count into a false "all read" state.
  if (count !== undefined) await setNativeBadge(count);
}

export function supportsNativePush() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" &&
    Capacitor.isPluginAvailable("PushNotifications") && Capacitor.isPluginAvailable("NativePushContext");
}

export async function nativePushPermission() {
  return (await PushNotifications.checkPermissions()).receive;
}

async function authorization() {
  const { data } = await supabase.auth.getSession();
  return data.session ? { headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, userId: data.session.user.id } : null;
}

function registerDevice() {
  return new Promise<string>((resolve, reject) => {
    const handles: PluginListenerHandle[] = [];
    let settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handles.forEach(handle => void handle.remove());
      if (token) resolve(token); else reject(new Error("native_registration"));
    };
    const timer = setTimeout(() => finish(), 15000);
    const listen = async () => {
      const success = await PushNotifications.addListener("registration", token => finish(token.value));
      if (settled) { await success.remove(); return; }
      handles.push(success);
      const failure = await PushNotifications.addListener("registrationError", () => finish());
      if (settled) { await failure.remove(); return; }
      handles.push(failure);
      await PushNotifications.register();
    };
    void listen().catch(() => finish());
  });
}

export async function ensureNativePush(options?: { prompt?: boolean }) {
  if (!supportsNativePush()) return { ok: false, reason: "native" };
  if (pending) return pending;
  const currentGeneration = generation;
  pending = (async () => {
    const auth = await authorization();
    if (!auth) return { ok: false, reason: "no_session" };
    const context = await contextPlugin.getContext();
    const readiness = await fetch(`/api/push/native?environment=${context.environment}`, { headers: auth.headers, cache: "no-store" });
    if (readiness.status === 401) return { ok: false, reason: "no_session" };
    if (!readiness.ok || !(await readiness.json()).configured) return { ok: false, reason: "missing_apns" };
    let permission = await nativePushPermission();
    if (permission === "denied") return { ok: false, reason: "denied" };
    if (permission !== "granted" && options?.prompt) permission = (await PushNotifications.requestPermissions()).receive;
    if (permission !== "granted") return { ok: false, reason: "not_granted" };
    // Ask APNs on every launch: its token may change after a restore or reinstall.
    const token = await registerDevice();
    const latest = await authorization();
    if (currentGeneration !== generation || latest?.userId !== auth.userId) return { ok: false, reason: "no_session" };
    const next = { ...context, token };
    const res = await fetch("/api/push/native", { method: "POST", headers: latest.headers,
      body: JSON.stringify({ ...next, locale: document.documentElement.lang }) });
    if (!res.ok) return { ok: false, reason: res.status === 503 ? "missing_apns" : "api_error" };
    if (currentGeneration !== generation) return { ok: false, reason: "no_session" };
    device = next;
    return { ok: true };
  })().catch(() => ({ ok: false, reason: "native_registration" })).finally(() => { pending = null; });
  return pending;
}

export async function hasNativePush() {
  if (!supportsNativePush() || await nativePushPermission() !== "granted") return false;
  // Registration also verifies the current session's server-side device binding.
  return (await ensureNativePush({ prompt: false })).ok;
}

export async function disableNativePush() {
  generation++;
  // Finish any in-flight registration before removing its server binding.
  await pending;
  if (!supportsNativePush()) return { ok: true };
  const auth = await authorization();
  if (!auth) return { ok: false, reason: "no_session" };
  const context = device ?? { ...await contextPlugin.getContext(), token: await registerDevice() };
  const response = await fetch("/api/push/native", { method: "DELETE", headers: auth.headers, body: JSON.stringify(context) });
  if (!response.ok) return { ok: false, reason: "api_error" };
  await PushNotifications.unregister();
  await PushNotifications.removeAllDeliveredNotifications();
  device = null;
  return { ok: true };
}

export async function clearNativePushSession() {
  generation++;
  badgeRevision++;
  device = null;
  if (!supportsNativePush()) return;
  await setNativeBadge(0).catch(() => {}); // Older binaries do not expose this method.
  await pending;
  // Server registrations also cascade with auth.sessions on sign-out.
  await PushNotifications.unregister();
  await PushNotifications.removeAllDeliveredNotifications();
}

export async function testNativePush(locale: string) {
  const auth = await authorization();
  if (!device || !auth) return { ok: false };
  const res = await fetch("/api/push/test", { method: "POST", headers: auth.headers,
    body: JSON.stringify({ nativeDevice: device, locale }) });
  return { ok: res.ok };
}

export async function listenToNativePush(open: (path: string) => void) {
  if (!supportsNativePush()) return () => {};
  const received = await PushNotifications.addListener("pushNotificationReceived", () => {
    window.dispatchEvent(new Event("notifications:changed"));
  });
  const clicked = await PushNotifications.addListener("pushNotificationActionPerformed", async action => {
    const data = action.notification.data;
    const auth = await authorization();
    if (!auth || data?.recipientUserId !== auth.userId) return;
    const path = typeof data.url === "string" ? data.url : "/";
    if (path.startsWith("/") && !path.startsWith("//") && !/[\u0000-\u0020\\]/.test(path)) open(path);
  });
  return () => { void received.remove(); void clicked.remove(); };
}
