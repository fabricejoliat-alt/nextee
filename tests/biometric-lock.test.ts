import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { biometricMessages } from "../lib/i18n/biometricMessages.ts";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";
import type * as NativeLock from "../lib/nativeBiometricLock.ts";

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

test("four languages cover settings, native lock and iOS Face ID permission", () => {
  const keys = Object.keys(biometricMessages.fr).sort();
  const nativeKeys = [...readFileSync("ios/App/App/fr.lproj/BiometricLock.strings", "utf8").matchAll(/^"([^"]+)"/gm)].map(match => match[1]).sort();
  for (const locale of ["fr", "en", "de", "it"] as const) {
    assert.deepEqual(Object.keys(biometricMessages[locale]).sort(), keys);
    assert.ok(Object.values(biometricMessages[locale]).every(value => value.trim().length > 0));
    assert.match(biometricMessages[locale].description, /\{method\}/);
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
