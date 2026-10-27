import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { installNativeSwipeHistory } from "../lib/nativeSwipeHistory.ts";

test("iOS bridge follows owned history and disables gestures for forms, focus, modals and cleanup", async () => {
  const calls: Array<{ href: string; enabled: boolean; canGoBack: boolean; canGoForward: boolean }> = [];
  const handlers = new Map<string, () => void>();
  let mutation: () => void, disconnected = false, blocked = false;
  const location = { href: "https://activitee.app/player", origin: "https://activitee.app" };
  const document = { documentElement: {}, addEventListener: (name: string, fn: () => void) => handlers.set(name, fn), removeEventListener: (name: string) => handlers.delete(name) };
  let entries: Array<{ href: string; state: unknown }> = [{ href: location.href, state: { __NA: true } }], index = 0;
  const history = {
    get state() { return entries[index].state; },
    pushState(state: unknown, _: string, url: string) { entries = entries.slice(0, index + 1); entries.push({ href: new URL(url, location.href).href, state }); index++; location.href = entries[index].href; },
    replaceState(state: unknown, _: string, url: string) { entries[index] = { href: new URL(url, location.href).href, state }; location.href = entries[index].href; },
    back() { index--; location.href = entries[index].href; handlers.get("popstate")?.(); },
    forward() { index++; location.href = entries[index].href; handlers.get("popstate")?.(); },
  };
  const store = new Map<string, string>();
  const win = { location, history, document, queueMicrotask, crypto: { randomUUID }, sessionStorage: { getItem: (k: string) => store.get(k), setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  const sandboxModule = { exports: {} as { installIOSSwipeNavigation: (w: unknown, blocked: () => boolean) => () => void; supportsIOSSwipeNavigation: () => boolean } };
  let platform = "ios", available = true;
  const compiled = ts.transpileModule(readFileSync(new URL("../lib/nativeIOSSwipeNavigation.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, MutationObserver: class {
    constructor(fn: () => void) { mutation = fn; }
    observe() {}
    disconnect() { disconnected = true; }
  }, require: (name: string) => {
    if (name === "@capacitor/core") return { Capacitor: { getPlatform: () => platform, isPluginAvailable: () => available }, registerPlugin: () => ({ setPolicy: async (p: typeof calls[number]) => { calls.push(p); } }) };
    if (name === "./nativeSwipeHistory.ts") return { installNativeSwipeHistory };
    throw new Error(name);
  } });
  const bridge = sandboxModule.exports;
  assert.equal(bridge.supportsIOSSwipeNavigation(), true);
  platform = "android"; assert.equal(bridge.supportsIOSSwipeNavigation(), false);
  platform = "ios"; available = false; assert.equal(bridge.supportsIOSSwipeNavigation(), false); available = true;
  const cleanup = bridge.installIOSSwipeNavigation(win, () => blocked);
  assert.equal(calls.at(-1)?.canGoBack, false);
  history.pushState({ __NA: true, tree: "om" }, "", "/player/om?child_id=example"); await Promise.resolve();
  assert.equal(calls.at(-1)?.canGoBack, true);
  assert.equal(calls.at(-1)?.href, location.href);
  blocked = true; mutation!(); await Promise.resolve(); assert.equal(calls.at(-1)?.enabled, false);
  blocked = false; handlers.get("focusout")!(); await Promise.resolve(); assert.equal(calls.at(-1)?.enabled, true);
  history.back(); await Promise.resolve(); assert.equal(calls.at(-1)?.canGoBack, false); assert.equal(calls.at(-1)?.canGoForward, true);
  const before = calls.length; mutation!(); await Promise.resolve(); assert.equal(calls.length, before);
  cleanup(); await Promise.resolve();
  assert.equal(disconnected, true); assert.equal(handlers.size, 0); assert.equal(calls.at(-1)?.enabled, false);
  mutation!(); await Promise.resolve(); assert.equal(calls.length, before + 1);
});
