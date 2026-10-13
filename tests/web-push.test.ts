/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated notification providers and browser fixtures. */
import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

const endpoint = "https://web.push.apple.com/test-device";
const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "fixture-public", VAPID_PRIVATE_KEY: "fixture-private" };
function sender(failure = false, providerStatus = 0) {
  const { db, writes } = managerDatabase({
    user_notification_preferences: [
      { user_id: "on", receive_push: true, receive_in_app: true, enabled_kinds: [] },
      { user_id: "off", receive_push: false, enabled_kinds: [] },
      { user_id: "muted", receive_push: true, receive_in_app: false, enabled_kinds: [] },
      { user_id: "filtered", receive_push: true, enabled_kinds: ["thread_message"] },
    ], push_subscriptions: ["on", "off", "muted", "filtered", "missing"].map((user_id, id) => ({ id, user_id, endpoint, p256dh: "fixture", auth: "fixture" })),
  }, { failureTable: failure ? "user_notification_preferences" : undefined });
  const sent: any[] = [];
  const mod = loadManagerModule<any>("lib/server/webPush.ts", {
    "web-push": { __esModule: true, default: { setVapidDetails() {}, async sendNotification(sub: any, payload: string) {
      sent.push({ sub, payload: JSON.parse(payload) }); if (providerStatus) throw { statusCode: providerStatus };
    } } },
  }, env);
  return { db, writes, sent, ...mod };
}

test("business delivery requires opt-in, enabled channel and a matching category", async () => {
  const s = sender();
  const result = await s.sendWebPush(s.db, { recipientUserIds: ["on", "off", "muted", "filtered", "missing"], kind: "coach_event_created", title: "ActiviTee", url: "https://outside.invalid" });
  assert.equal(result.sent, 1); assert.equal(s.sent.length, 1); assert.equal(s.sent[0].payload.url, "/");
});

test("unavailable preferences fail closed instead of notifying opted-out users", async () => {
  const s = sender(true);
  await assert.rejects(s.sendWebPush(s.db, { recipientUserIds: ["on"], kind: "thread_message", title: "Test" }), /preferences unavailable/);
  assert.equal(s.sent.length, 0);
});

test("provider failures are not reported as successful delivery; expired devices are removed", async () => {
  for (const status of [403, 410]) {
    const s = sender(false, status);
    const result = await s.sendWebPush(s.db, { recipientUserIds: ["on"], kind: "thread_message", title: "Test" });
    assert.equal(result.sent, 0); assert.equal(result.failed, 1); assert.equal(result.cleaned, status === 410 ? 1 : 0);
  }
});

test("push destinations and click links cannot reach arbitrary or private servers", () => {
  const s = sender();
  assert(s.validPushEndpoint(endpoint));
  for (const url of ["https://localhost/push", "http://web.push.apple.com/push", "https://web.push.apple.com.evil.invalid/x", "https://user:password@web.push.apple.com/x", "https://web.push.apple.com:8443/x"]) assert.equal(s.validPushEndpoint(url), false, url);
  for (const url of ["//outside.invalid", "/\\outside.invalid", "javascript:alert(1)", "https://outside.invalid"]) assert.equal(s.notificationPath(url), "/");
  assert.equal(s.notificationPath("https://activitee.app/player?section=stats"), "/player?section=stats");
});

test("test notifications target only the authenticated user's registered device", async () => {
  const { db } = managerDatabase({}, { caller: "player" });
  let delivery: any;
  const route = loadManagerModule<any>("app/api/push/test/route.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/server/webPush": { validPushEndpoint: () => true, sendWebPush: async (_db: unknown, input: any) => { delivery = input; return { sent: 1 }; } },
    "next/server": { NextResponse: { json: Response.json } },
  });
  const response = await route.POST(new Request("https://app.invalid/api/push/test", { method: "POST", headers: { authorization: "Bearer fixture", "Content-Type": "application/json" }, body: JSON.stringify({ endpoint, recipientUserIds: ["someone-else"], locale: "de" }) }));
  assert.equal(response.status, 200); assert.deepEqual(delivery.recipientUserIds, ["player"]); assert.equal(delivery.endpoint, endpoint);
});

test("a caller cannot dispatch pushes without a stored notification they own", async () => {
  const { db } = managerDatabase({ notifications: [{ id: "other", actor_user_id: "other" }] }, { caller: "player" });
  let sent = false;
  const route = loadManagerModule<any>("app/api/push/dispatch/route.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/server/webPush": { sendWebPush: async () => { sent = true; }, notificationPath: () => "/" },
    "next/server": { NextResponse: { json: Response.json } },
  });
  const request = (body: object) => new Request("https://app.invalid/api/push/dispatch", { method: "POST", headers: { authorization: "Bearer fixture", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({ recipientUserIds: ["other"] }))).status, 400);
  assert.equal((await route.POST(request({ notificationId: "other", recipientUserIds: ["other"] }))).status, 403);
  assert.equal(sent, false);
});

function browserFixture(t: any, fetcher: typeof fetch, ready: Promise<any>) {
  const old = ["window", "navigator", "Notification"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const calls: string[] = [];
  const sub = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "fixture", auth: "fixture" } }), unsubscribe: async () => { calls.push("unsubscribe"); return true; } };
  const registration = { pushManager: { getSubscription: async () => null, subscribe: async () => { calls.push("subscribe"); return sub; } } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { PushManager: {}, Notification: {} } });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: { permission: "default", requestPermission: () => { calls.push("permission"); return Promise.resolve("granted"); } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serviceWorker: { register: async () => { calls.push("register"); return registration; }, ready, getRegistration: async () => registration } } });
  t.after(() => old.forEach(([key, descriptor]) => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key)));
  const module = loadManagerModule<any>("lib/pushClient.ts", {
    "@/lib/supabaseClient": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fixture" } } }) } } }, fetch: fetcher,
  }, { NEXT_PUBLIC_VAPID_PUBLIC_KEY: Buffer.alloc(65).toString("base64url") });
  return { module, registration, calls, sub };
}

test("permission is requested directly on the tap and subscription waits for the active worker", async (t) => {
  let activate!: (value: unknown) => void;
  const f = browserFixture(t, async () => Response.json({ ok: true }), new Promise(resolve => { activate = resolve; }));
  const pending = f.module.ensurePushSubscription({ prompt: true });
  assert.equal(f.calls[0], "permission");
  await Promise.resolve(); await Promise.resolve();
  assert(!f.calls.includes("subscribe"));
  activate(f.registration);
  assert.deepEqual(await pending, { ok: true }); assert(f.calls.includes("subscribe"));
});

test("a failed server unsubscribe is shown as an error and retains the local subscription", async (t) => {
  const f = browserFixture(t, async () => Response.json({ error: "offline" }, { status: 503 }), Promise.resolve({}));
  f.registration.pushManager.getSubscription = async () => f.sub as any;
  assert.deepEqual(await f.module.disablePushSubscription(), { ok: false, reason: "api_error" });
  assert(!f.calls.includes("unsubscribe"));
});
