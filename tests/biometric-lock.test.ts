import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { biometricMessages } from "../lib/i18n/biometricMessages.ts";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";
import type * as NativeLock from "../lib/nativeBiometricLock.ts";
import type * as Invitation from "../lib/biometricInvitation.ts";

function fixture(platform = "ios", registered = true) {
  const calls: Array<{ method: string; options?: unknown }> = [];
  const status = { available: true, enabled: false, locked: false, biometryType: "faceID" };
  const api = loadManagerModule<typeof NativeLock>("lib/nativeBiometricLock.ts", {
    "@capacitor/core": {
      Capacitor: { isNativePlatform: () => platform !== "web", getPlatform: () => platform, isPluginAvailable: () => registered },
      registerPlugin: (name: string) => {
        assert.equal(name, "BiometricLock");
        return {
          getStatus: async () => { calls.push({ method: "getStatus" }); return status; },
          configure: async (options: unknown) => { calls.push({ method: "configure", options }); return { ...status, enabled: true }; },
          syncSession: async (options: unknown) => { calls.push({ method: "syncSession", options }); },
        };
      },
    },
  });
  return { api, calls };
}

test("web, Android and older iOS builds do not call the native plugin", async () => {
  for (const [platform, registered] of [["web", true], ["android", true], ["ios", false]] as const) {
    const { api, calls } = fixture(platform, registered);
    assert.equal(await api.getBiometricLockStatus(), null);
    await api.syncBiometricSession(null, "fr");
    await assert.rejects(api.configureBiometricLock("parent", true, "fr"));
    assert.deepEqual(calls, []);
  }
});

test("device setup sends only the account ID, language and preference, with explicit opt-in", async () => {
  const { api, calls } = fixture();
  assert.equal((await api.getBiometricLockStatus())?.enabled, false);
  assert.equal(calls.some(call => call.method === "configure"), false);
  await api.configureBiometricLock("parent-account", true, "de");
  await api.syncBiometricSession(null, "it");
  assert.deepEqual(calls.slice(1), [
    { method: "configure", options: { userID: "parent-account", enabled: true, locale: "de" } },
    { method: "syncSession", options: { userID: null, locale: "it" } },
  ]);
});

test("cancellation and unavailable biometrics are recoverable, localized outcomes", () => {
  const { api } = fixture();
  assert.equal(api.biometricErrorKey({ code: "CANCELLED" }), "cancelled");
  assert.equal(api.biometricErrorKey({ code: "UNAVAILABLE" }), "unavailable");
  for (const error of [null, "error", { code: "LOCKED" }, new Error("secret system detail")]) assert.equal(api.biometricErrorKey(error), "error");
});

test("invitation is offered once per account and remains dismissed across app restarts", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const status = { enabled: false, available: true, locked: false, biometryType: "faceID" as const };
  const { claimBiometricInvitation: claim } = loadManagerModule<typeof Invitation>("lib/biometricInvitation.ts", {});
  assert.equal(claim("parent", status, storage), true);
  assert.equal(claim("parent", status, storage), false);
  const restarted = loadManagerModule<typeof Invitation>("lib/biometricInvitation.ts", {});
  assert.equal(restarted.claimBiometricInvitation("parent", status, storage), false);
  assert.equal(restarted.claimBiometricInvitation("another-account", status, storage), true);
  assert.deepEqual([...values.values()], ["offered", "offered"]);
});

test("invitation waits for an unlocked compatible device and skips an already enabled account", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const status = { enabled: false, available: true, locked: false, biometryType: "faceID" as const };
  const { claimBiometricInvitation: claim } = loadManagerModule<typeof Invitation>("lib/biometricInvitation.ts", {});
  for (const state of [null, { ...status, available: false }, { ...status, locked: true }, { ...status, biometryType: "none" as const }]) {
    assert.equal(claim("player", state, storage), false);
  }
  assert.equal(values.size, 0);
  assert.equal(claim("player", status, storage), true);
  assert.equal(claim("enabled-account", { ...status, enabled: true }, storage), false);
  assert.equal(claim("enabled-account", status, storage), false);
});

test("unavailable preference storage never blocks access or repeats an invitation in the same session", () => {
  const storage = { getItem(): null { throw new Error("Storage blocked"); }, setItem() { throw new Error("Storage blocked"); } };
  const { claimBiometricInvitation: claim } = loadManagerModule<typeof Invitation>("lib/biometricInvitation.ts", {});
  const status = { enabled: false, available: true, locked: false, biometryType: "touchID" as const };
  assert.equal(claim("account", status, storage), true);
  assert.equal(claim("account", status, storage), false);
});

test("four languages cover settings, native lock and iOS Face ID permission", () => {
  const keys = Object.keys(biometricMessages.fr).sort();
  const nativeKeys = [...readFileSync("ios/App/App/fr.lproj/BiometricLock.strings", "utf8").matchAll(/^"([^"]+)"/gm)].map(match => match[1]).sort();
  for (const locale of ["fr", "en", "de", "it"] as const) {
    assert.deepEqual(Object.keys(biometricMessages[locale]).sort(), keys);
    assert.ok(Object.values(biometricMessages[locale]).every(value => value.trim().length > 0));
    assert.match(biometricMessages[locale].description, /\{method\}/);
    assert.match(biometricMessages[locale].disable, /\{method\}/);
    assert.match(biometricMessages[locale].invitationTitle, /\{method\}/);
    const native = readFileSync(`ios/App/App/${locale}.lproj/BiometricLock.strings`, "utf8");
    assert.deepEqual([...native.matchAll(/^"([^"]+)"/gm)].map(match => match[1]).sort(), nativeKeys);
    assert.match(readFileSync(`ios/App/App/${locale}.lproj/InfoPlist.strings`, "utf8"), /"NSFaceIDUsageDescription" = ".+";/);
  }
});

test("auth boundary keeps the native lock on transient sessions and clears it only on explicit sign-out", async (t) => {
  const synchronized: Array<string | null> = [];
  const storage = new Map<string, string>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  let onAuth!: (event: string, session: { user: { id: string } } | null) => void;
  let effect!: () => () => void;
  let unsubscribed = false;
  const component = loadManagerModule<{ default: () => null }>("components/auth/AuthSessionBoundary.tsx", {
    react: { useEffect: (callback: typeof effect) => { effect = callback; } },
    "@/lib/nativeBiometricLock": { syncBiometricSession: async (id: string | null) => { synchronized.push(id); } },
    "@/lib/clientPageCache": { invalidateClientPageCacheByPrefix() {} },
    "@/lib/supabaseClient": { supabase: { auth: {
      getUser: async () => ({ data: { user: null }, error: new Error("temporary network failure") }),
      onAuthStateChange: (callback: typeof onAuth) => { onAuth = callback; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; },
    } } },
  });
  component.default();
  const cleanup = effect();
  await new Promise(resolve => setImmediate(resolve));
  onAuth("INITIAL_SESSION", null);
  onAuth("TOKEN_REFRESHED", null);
  assert.deepEqual(synchronized, []);
  onAuth("SIGNED_IN", { user: { id: "parent-account" } });
  onAuth("TOKEN_REFRESHED", { user: { id: "parent-account" } });
  onAuth("SIGNED_OUT", null);
  assert.deepEqual(synchronized, ["parent-account", "parent-account", null]);
  cleanup();
  assert.ok(unsubscribed);
});
