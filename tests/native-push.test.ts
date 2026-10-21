/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated APNs, native bridge and database fixtures. */
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const env = { APNS_TEAM_ID: "TEAM123456", APNS_KEY_ID: "PROD123456", APNS_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  APNS_SANDBOX_KEY_ID: "TEST123456", APNS_SANDBOX_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const token = "ab".repeat(32);
const device = { token, environment: "sandbox", bundleId: "golf.activitee.app" };

test("APNs signs an ES256 JWT with the right environment key and renews it", () => {
  const apns = loadManagerModule<any>("lib/server/apns.ts", {}, env);
  const jwt = apns.apnsAuthorization("sandbox", 10000);
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).kid, env.APNS_SANDBOX_KEY_ID);
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { iss: env.APNS_TEAM_ID, iat: 10000 });
  assert(verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
  assert.equal(apns.apnsAuthorization("sandbox", 11000), jwt);
  assert.notEqual(apns.apnsAuthorization("sandbox", 12001), jwt);
  assert.equal(JSON.parse(Buffer.from(apns.apnsAuthorization("production", 12001).split(".")[0], "base64url").toString()).kid, env.APNS_KEY_ID);
});

test("APNs payloads fit Apple's limit with Unicode and use visible alerts", () => {
  const apns = loadManagerModule<any>("lib/server/apns.ts", {}, env);
  const payload = apns.apnsPayload({ title: "🏌️".repeat(300), body: "🏌️".repeat(3000), url: "/player/marketplace/messages", recipientUserId: "player", badgeCount: -1 });
  assert(Buffer.byteLength(payload) <= 4096);
  const data = JSON.parse(payload);
  assert.equal(data.aps.sound, "default"); assert.equal(data.aps.badge, 0);
  assert(!data.aps.alert.body.includes("�")); assert.equal(data.url, "/player/marketplace/messages");
  assert(Buffer.byteLength(apns.apnsPayload({ title: "\u0001".repeat(200), body: "\u0001".repeat(2000), url: "/", recipientUserId: "player" })) <= 4096);
  assert(apns.validNativePushDevice(device));
  for (const invalid of [{ ...device, bundleId: "other.app" }, { ...device, token: "../../x" }, { ...device, environment: "other" }]) assert.equal(apns.validNativePushDevice(invalid), false);
});

test("APNs uses alert headers, reports actual acceptance and only cleans invalid tokens", async () => {
  const apns = loadManagerModule<any>("lib/server/apns.ts", {}, env);
  for (const [status, reason, sent, stale] of [[200, "", true, false], [403, "InvalidProviderToken", false, false], [429, "TooManyRequests", false, false], [410, "Unregistered", false, true], [400, "BadDeviceToken", false, true]]) {
    let headers: any;
    const request = new EventEmitter() as any;
    request.setEncoding = () => {};
    request.end = () => { request.emit("response", { ":status": status }); request.emit("data", JSON.stringify({ reason })); request.emit("end"); request.emit("close"); };
    const result = await apns.sendApns({ request(h: any) { headers = h; return request; } }, device, "{}");
    assert.equal(headers["apns-topic"], device.bundleId); assert.equal(headers["apns-push-type"], "alert");
    assert.equal(headers[":path"], `/3/device/${token}`); assert.deepEqual(result, { sent, stale });
  }
});

test("native delivery works without VAPID and honors account, category and device restrictions", async () => {
  const { db } = managerDatabase({
    user_notification_preferences: [
      { user_id: "on", receive_push: true, receive_in_app: true, enabled_kinds: ["marketplace_message"] },
      { user_id: "off", receive_push: false }, { user_id: "muted", receive_push: true, receive_in_app: false },
      { user_id: "category", receive_push: true, enabled_kinds: ["coach_event_created"] },
    ], native_push_subscriptions: ["on", "off", "muted", "category", "other"].map((user_id, id) => ({ id, user_id, device_token: token, environment: "sandbox", bundle_id: device.bundleId, locale: "fr" })),
  });
  const sent: any[] = [];
  const sender = loadManagerModule<any>("lib/server/webPush.ts", {
    "@/lib/server/apns": { apnsConfigured: () => true, openApnsConnection: () => ({ close() {} }), apnsPayload: (v: any) => v,
      sendApns: async (_: any, d: any, p: any) => { sent.push({ d, p }); return { sent: true, stale: false }; } },
  });
  const result = await sender.sendWebPush(db, { recipientUserIds: ["on", "off", "muted", "category"], kind: "marketplace_message", title: "Message", url: "https://evil.invalid", nativeDevice: device });
  assert.equal(result.sent, 1); assert.equal(sent[0].p.recipientUserId, "on"); assert.equal(sent[0].p.url, "/");
});

test("each native recipient gets their own global unread count, including zero, rather than the thread count", async () => {
  const { db } = managerDatabase({
    user_notification_preferences: ["a", "b"].map(user_id => ({ user_id, receive_push: true })),
    native_push_subscriptions: ["a", "b", "a"].map((user_id, id) => ({ id, user_id, device_token: token, environment: "production", bundle_id: device.bundleId })),
  });
  let reads = 0;
  const sent: any[] = [];
  const sender = loadManagerModule<any>("lib/server/webPush.ts", {
    "@/lib/notificationBadgeCounts": { loadNotificationBadgeCounts: async () => { reads++; return new Map([["a", 7], ["b", 0]]); } },
    "@/lib/server/apns": { apnsConfigured: () => true, openApnsConnection: () => ({ close() {} }), apnsPayload: (v: any) => v,
      sendApns: async (_: any, _d: any, p: any) => { sent.push(p); return { sent: true }; } },
  });
  await sender.sendWebPush(db, { recipientUserIds: ["a", "b"], kind: "marketplace_message", title: "Message", badgeCount: 99 });
  assert.equal(reads, 1);
  assert.deepEqual(sent.map(p => [p.recipientUserId, p.badgeCount]), [["a", 7], ["b", 0], ["a", 7]]);
});

const sessionId = "11111111-1111-4111-8111-111111111111";
const jwt = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.signature`;
test("native API binds devices to the authenticated user and session, and cannot delete another user's device", async () => {
  const { db, writes } = managerDatabase({ native_push_subscriptions: [{ id: 1, user_id: "other", device_token: token, environment: "sandbox", bundle_id: device.bundleId }] }, { caller: "player" });
  const route = loadManagerModule<any>("app/api/push/native/route.ts", { "@supabase/supabase-js": { createClient: () => db }, "next/server": { NextResponse: { json: Response.json } } }, env);
  const req = (method: string, body: any, bearer = jwt) => new Request("https://activitee.app/api/push/native", { method, headers: { authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(req("POST", { ...device, user_id: "other", session_id: "other", locale: "de" }))).status, 200);
  assert.equal(writes[0].values.user_id, "player"); assert.equal(writes[0].values.session_id, sessionId); assert.equal(writes[0].values.locale, "de");
  assert.equal((await route.POST(req("POST", device, "invalid"))).status, 401);
  assert.equal((await route.DELETE(req("DELETE", device))).status, 200);
  assert.equal(writes[1].rows.length, 0);
});

function nativeFixture(t: any, options: { configured?: boolean; permission?: string; rejectRegistration?: boolean; failPost?: boolean; badgeCounts?: () => Promise<Map<string, number>> } = {}) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "fr" } } });
  t.after(() => oldDocument ? Object.defineProperty(globalThis, "document", oldDocument) : Reflect.deleteProperty(globalThis, "document"));
  const events = new Map<string, (...args: any[]) => void>();
  const calls: string[] = [];
  let permission = options.permission ?? "prompt";
  let userId: string | null = "player";
  const push = {
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => { calls.push("permission"); permission = "granted"; return { receive: permission }; },
    addListener: async (name: string, fn: (...args: any[]) => void) => { events.set(name, fn); return { remove: async () => events.delete(name) }; },
    register: async () => { calls.push("register"); events.get(options.rejectRegistration ? "registrationError" : "registration")?.({ value: token }); },
    unregister: async () => { calls.push("unregister"); }, removeAllDeliveredNotifications: async () => {},
  };
  const mod = loadManagerModule<any>("lib/nativePush.ts", {
    "@capacitor/core": { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", isPluginAvailable: () => true }, registerPlugin: () => ({ getContext: async () => ({ environment: "sandbox", bundleId: device.bundleId }), setBadgeCount: async ({ count }: any) => { calls.push(`badge:${count}`); } }) },
    "@capacitor/push-notifications": { PushNotifications: push },
    "@/lib/supabaseClient": { supabase: { auth: { getSession: async () => ({ data: { session: userId ? { access_token: jwt, user: { id: userId } } : null } }) } } },
    "@/lib/notificationBadgeCounts": { loadNotificationBadgeCounts: options.badgeCounts ?? (async () => new Map([["player", 3]])) },
    fetch: async (_: string, init: any) => { calls.push(init?.method ?? "GET"); return Response.json(init?.method ? { ok: !options.failPost } : { configured: options.configured !== false }, { status: init?.method === "POST" && options.failPost ? 503 : 200 }); },
  });
  return { ...mod, calls, events, setUser: (id: string | null) => { userId = id; } };
}

test("native badge synchronizes unread and all-read states without asking for permission", async t => {
  let count = 3;
  const f = nativeFixture(t, { badgeCounts: async () => new Map([["player", count]]) });
  await f.syncNativeBadge(); count = 0; await f.syncNativeBadge();
  assert.deepEqual(f.calls, ["badge:3", "badge:0"]);
});

test("logout clears the native badge and discards counts from the previous account", async t => {
  let resolve!: (counts: Map<string, number>) => void;
  let started!: () => void;
  const ready = new Promise<void>(r => { started = r; });
  const f = nativeFixture(t, { badgeCounts: () => { started(); return new Promise(r => { resolve = r; }); } });
  const pending = f.syncNativeBadge(); await ready;
  f.setUser(null); await f.clearNativePushSession(); resolve(new Map([["player", 12]])); await pending;
  assert.deepEqual(f.calls.filter((c: string) => c.startsWith("badge:")), ["badge:0"]);
});

test("a failed badge count does not erase an unread badge", async t => {
  const f = nativeFixture(t, { badgeCounts: async () => { throw new Error("offline"); } });
  await assert.rejects(f.syncNativeBadge(), /offline/);
  assert(!f.calls.some((c: string) => c.startsWith("badge:")));
});

test("native activation prompts only on a tap, waits for APNs and removes registration listeners", async t => {
  const f = nativeFixture(t);
  assert.deepEqual(await f.ensureNativePush({ prompt: false }), { ok: false, reason: "not_granted" });
  assert(!f.calls.includes("permission"));
  assert.deepEqual(await f.ensureNativePush({ prompt: true }), { ok: true });
  assert(f.calls.indexOf("permission") < f.calls.indexOf("register")); assert(f.calls.includes("POST")); assert.equal(f.events.size, 0);
  assert.deepEqual(await f.disableNativePush(), { ok: true }); assert(f.calls.includes("DELETE")); assert(f.calls.includes("unregister"));
});

test("missing server configuration or denied permission never pretends native activation succeeded", async t => {
  const missing = nativeFixture(t, { configured: false });
  assert.deepEqual(await missing.ensureNativePush({ prompt: true }), { ok: false, reason: "missing_apns" }); assert(!missing.calls.includes("permission"));
  const denied = nativeFixture(t, { permission: "denied" });
  assert.deepEqual(await denied.ensureNativePush({ prompt: true }), { ok: false, reason: "denied" }); assert(!denied.calls.includes("POST"));
  const failed = nativeFixture(t, { rejectRegistration: true });
  assert.deepEqual(await failed.ensureNativePush({ prompt: true }), { ok: false, reason: "native_registration" }); assert(!failed.calls.includes("POST"));
});
