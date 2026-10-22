/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated provider and native-bridge fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = { FCM_PROJECT_ID: "activitee-android-push", FCM_CLIENT_EMAIL: "push@example.invalid",
  FCM_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const device = { token: "android_token_" + "Abcd0123_-".repeat(16), applicationId: "golf.activitee.app" };

test("FCM uses a signed, messaging-only Google grant, caches OAuth and handles stale tokens conservatively", async () => {
  let oauth = 0, status = 200, code = "";
  const fcm = loadManagerModule<any>("lib/server/fcm.ts", { fetch: async (url: string, init: any) => {
    if (url === "https://oauth2.googleapis.com/token") {
      oauth++;
      const jwt = init.body.get("assertion");
      const [h, p, s] = jwt.split(".");
      const claims = JSON.parse(Buffer.from(p, "base64url").toString());
      assert.equal(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");
      assert.equal(claims.aud, url);
      assert(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")));
      return Response.json({ access_token: "test-only-access", expires_in: 3600 });
    }
    assert.equal(url, "https://fcm.googleapis.com/v1/projects/activitee-android-push/messages:send");
    const payload = JSON.parse(init.body).message;
    assert.equal(payload.token, device.token);
    assert.equal(payload.android.restricted_package_name, device.applicationId);
    return Response.json(status === 200 ? { name: "accepted" } : { error: { details: [{ errorCode: code }] } }, { status });
  } }, env);
  const message = fcm.fcmMessage({ title: "🏌️".repeat(300), body: "\u0001".repeat(5000), url: "/player/notifications", recipientUserId: "player", badgeCount: 3 });
  assert(Buffer.byteLength(JSON.stringify(message)) <= 3900);
  assert.equal(message.android.notification.channel_id, "activitee");
  assert.equal(message.android.notification.notification_count, 3);
  assert(fcm.validAndroidPushDevice(device));
  assert(!fcm.validAndroidPushDevice({ ...device, applicationId: "other.app" }));
  assert.deepEqual(await fcm.sendFcm(device, message), { sent: true, stale: false });
  status = 404; code = "UNREGISTERED";
  assert.deepEqual(await fcm.sendFcm(device, message), { sent: false, stale: true });
  status = 403; code = "PERMISSION_DENIED";
  assert.deepEqual(await fcm.sendFcm(device, message), { sent: false, stale: false });
  assert.equal(oauth, 1);
});

const sessionId = "11111111-1111-4111-8111-111111111111";
const jwt = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.signature`;
test("Android API binds the authenticated session and cannot remove another account's token", async () => {
  const { db, writes } = managerDatabase({ android_push_subscriptions: [{ user_id: "other", device_token: device.token, application_id: device.applicationId }] }, { caller: "player" });
  const route = loadManagerModule<any>("app/api/push/android/route.ts", { "@supabase/supabase-js": { createClient: () => db }, "next/server": { NextResponse: { json: Response.json } } }, env);
  const req = (method: string, body: any, bearer = jwt) => new Request("https://activitee.app/api/push/android", { method,
    headers: { authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(req("POST", { ...device, user_id: "other", session_id: "spoof", locale: "de" }))).status, 200);
  assert.equal(writes[0].values.user_id, "player");
  assert.equal(writes[0].values.session_id, sessionId);
  assert.equal(writes[0].values.locale, "de");
  assert.equal((await route.POST(req("POST", device, "invalid"))).status, 401);
  assert.equal((await route.DELETE(req("DELETE", device))).status, 200);
  assert.equal(writes[1].rows.length, 0);
});

test("Android delivery respects consent, categories, recipient isolation and the selected test device", async () => {
  const { db } = managerDatabase({ user_notification_preferences: [
    { user_id: "on", receive_push: true }, { user_id: "off", receive_push: false },
    { user_id: "category", receive_push: true, enabled_kinds: ["manager_news"] },
  ], android_push_subscriptions: ["on", "off", "category", "other"].map((user_id, id) => ({ id, user_id, device_token: device.token,
    application_id: device.applicationId, locale: "fr", updated_at: "now" })) });
  const sent: any[] = [];
  const sender = loadManagerModule<any>("lib/server/webPush.ts", {
    "@/lib/server/fcm": { fcmConfigured: () => true, fcmMessage: (p: any) => p, sendFcm: async (d: any, p: any) => { sent.push({ d, p }); return { sent: true }; } },
  });
  const result = await sender.sendWebPush(db, { recipientUserIds: ["on", "off", "category"], kind: "marketplace_message", title: "Test",
    url: "https://evil.invalid", androidDevice: device });
  assert.equal(result.sent, 1);
  assert.equal(sent[0].p.recipientUserId, "on");
  assert.equal(sent[0].p.url, "/");
});

test("Android grants on older OS versions do not silently enroll a device before Yes", async () => {
  let accepted = false;
  const calls: string[] = [], listeners = new Map<string, (v: any) => void>();
  const client = loadManagerModule<any>("lib/nativePush.ts", {
    "@capacitor/core": { Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", isPluginAvailable: () => true },
      registerPlugin: () => ({ getContext: async () => ({ environment: "production", bundleId: device.applicationId, firebaseConfigured: true }) }) },
    "@capacitor/push-notifications": { PushNotifications: { checkPermissions: async () => ({ receive: "granted" }),
      addListener: async (name: string, fn: any) => { listeners.set(name, fn); return { remove: async () => listeners.delete(name) }; },
      register: async () => { calls.push("register"); listeners.get("registration")?.({ value: device.token }); } } },
    "@/lib/pushOnboarding": { readPushDecision: () => accepted ? "accepted" : null, rememberPushDecision: () => { accepted = true; } },
    "@/lib/supabaseClient": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: jwt, user: { id: "player" } } } }) } } },
    fetch: async (url: string, init: any) => {
      calls.push(`${init?.method ?? "GET"}:${url}`);
      if (init?.method === "POST") assert.deepEqual(JSON.parse(init.body), { ...device, locale: "fr" });
      return Response.json(init?.method ? { ok: true } : { configured: true });
    },
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "fr" } } });
  try {
    assert.deepEqual(await client.ensureNativePush({ prompt: false }), { ok: false, reason: "not_granted" });
    assert.equal(calls.length, 0);
    assert.deepEqual(await client.ensureNativePush({ prompt: true }), { ok: true });
    assert(calls.includes("POST:/api/push/android"));
    assert.equal(accepted, true);
    assert.equal(listeners.size, 0);
  } finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});
