import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { edgeSwipeMovement, isSwipeAppPath, isSwipeEditingPath, startEdgeSwipe } from "../lib/nativeSwipeNavigation.ts";
import { installNativeSwipeHistory } from "../lib/nativeSwipeHistory.ts";

function browser(path = "/player") {
  let entries: Array<{ url: string; state: unknown }> = [{ url: "https://outside.example/", state: null }, { url: "https://activitee.app" + path, state: { __NA: true, tree: { route: path } } }], cursor = 1;
  const handlers = new Map<string, Set<() => void>>(), storage = new Map<string, string>();
  const emit = (name: string) => handlers.get(name)?.forEach(fn => fn());
  const location = { href: entries[cursor].url, origin: "https://activitee.app" };
  const history = {
    get state() { return structuredClone(entries[cursor].state) as Record<string, unknown>; },
    get length() { return entries.length; },
    pushState(data: unknown, _unused: string, url?: string | URL | null) { entries = entries.slice(0, cursor + 1); entries.push({ url: new URL(url == null ? location.href : String(url), location.href).href, state: structuredClone(data) }); cursor++; location.href = entries[cursor].url; },
    replaceState(data: unknown, _unused: string, url?: string | URL | null) { entries[cursor] = { url: new URL(url == null ? location.href : String(url), location.href).href, state: structuredClone(data) }; location.href = entries[cursor].url; },
    back() { if (cursor > 0) { cursor--; location.href = entries[cursor].url; emit("popstate"); } },
    forward() { if (cursor < entries.length - 1) { cursor++; location.href = entries[cursor].url; emit("popstate"); } },
  };
  const win = { history, location, crypto: { randomUUID }, sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }, addEventListener: (type: string, fn: () => void) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type)!.add(fn); }, removeEventListener: (type: string, fn: () => void) => handlers.get(type)?.delete(fn) };
  return { win: win as unknown as Window, history, location, emit };
}

test("only an inward edge gesture completes; scrolling, a diagonal, a slow drag and the centre do not", () => {
  const right = startEdgeSwipe({ x: 12, y: 300, time: 0 }, 390)!;
  assert.equal(right.direction, "back");
  assert.equal(edgeSwipeMovement(right, { x: 110, y: 310, time: 300 }).complete, true);
  assert.equal(edgeSwipeMovement(right, { x: 30, y: 340, time: 100 }).cancelled, true);
  assert.equal(edgeSwipeMovement(right, { x: 110, y: 360, time: 300 }).complete, false);
  assert.equal(edgeSwipeMovement(right, { x: 110, y: 300, time: 1100 }).complete, false);
  assert.equal(edgeSwipeMovement(right, { x: 70, y: 300, time: 300 }).complete, false);
  const left = startEdgeSwipe({ x: 380, y: 300, time: 0 }, 390)!;
  assert.equal(left.direction, "forward");
  assert.equal(edgeSwipeMovement(left, { x: 280, y: 300, time: 300 }).complete, true);
  assert.equal(startEdgeSwipe({ x: 190, y: 300, time: 0 }, 390), null);
});

test("gestures cannot leave the app's initial entry; Back and Forward preserve Next state and parent query context", () => {
  const b = browser(), tracker = installNativeSwipeHistory(b.win);
  assert.equal(tracker.navigate("back"), false); assert.equal(tracker.navigate("forward"), false);
  b.history.pushState({ __NA: true, tree: { route: "om" } }, "", "/player/om?child_id=test-child");
  assert.equal(b.history.state.__NA, true); assert.deepEqual(b.history.state.tree, { route: "om" });
  assert.equal(tracker.navigate("back"), true); assert.equal(b.location.href, "https://activitee.app/player");
  assert.equal(tracker.navigate("back"), false);
  assert.equal(tracker.navigate("forward"), true); assert.equal(b.location.href, "https://activitee.app/player/om?child_id=test-child");
  assert.equal(tracker.navigate("forward"), false); tracker.dispose();
});

test("replace creates no extra back step; navigating after Back discards stale Forward entries", () => {
  const b = browser(), tracker = installNativeSwipeHistory(b.win);
  b.history.replaceState({ __NA: true }, "", "/player?view=summary");
  assert.equal(tracker.canNavigate("back"), false);
  b.history.pushState({ __NA: true }, "", "/player/om");
  tracker.navigate("back");
  b.history.pushState({ __NA: true }, "", "/player/messages");
  assert.equal(tracker.canNavigate("forward"), false);
  tracker.navigate("back"); tracker.navigate("forward");
  assert.equal(b.location.href, "https://activitee.app/player/messages"); tracker.dispose();
});

test("auth pages and unknown entries reset the boundary; a full page departure cannot expose an external Forward entry", () => {
  const b = browser(), tracker = installNativeSwipeHistory(b.win);
  b.history.pushState({}, "", "/player/om"); tracker.navigate("back"); b.emit("pagehide");
  assert.equal(tracker.canNavigate("forward"), false);
  b.history.replaceState({}, "", "/login"); assert.equal(tracker.canNavigate("back"), false);
  b.history.pushState({}, "", "/manager"); assert.equal(tracker.canNavigate("back"), false);
  tracker.dispose();
  assert.equal(isSwipeAppPath("/login"), false); assert.equal(isSwipeAppPath("/player-other"), false);
  assert.equal(isSwipeEditingPath("/player/golf/rounds/new"), true); assert.equal(isSwipeEditingPath("/manager/settings"), true);
});

test("reload keeps owned history, and cleanup does not overwrite a newer router wrapper", () => {
  const b = browser(), first = installNativeSwipeHistory(b.win);
  b.history.pushState({ __NA: true }, "", "/player/om"); first.navigate("back"); first.dispose();
  const second = installNativeSwipeHistory(b.win);
  assert.equal(second.navigate("forward"), true);
  const wrapped = b.history.pushState;
  const routerWrapper = (...args: Parameters<History["pushState"]>) => wrapped.apply(b.history, args);
  b.history.pushState = routerWrapper;
  second.dispose(); assert.equal(b.history.pushState, routerWrapper);
  b.history.pushState({ __NA: true }, "", "/coach"); assert.equal(b.location.href, "https://activitee.app/coach");
});

// Exercise the actual component's event listeners with a native bridge and DOM
// boundary stand-ins; no production session or browser platform is modified.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
function mountedNavigation(native = true) {
  const b = browser();
  Object.defineProperty(b.location, "pathname", { get: () => new URL(b.location.href).pathname });
  Object.assign(b.win, { innerWidth: 390, innerHeight: 844 });
  class Target {
    guarded = false; scrollWidth = 0; clientWidth = 0; parentElement: Target | null = null;
    closest() { return this.guarded ? this : null; }
    matches() { return this.guarded; }
  }
  let blocked = false, now = 1000;
  const listeners = new Map<string, (event: unknown) => void>();
  const doc = { body: new Target(), activeElement: null, querySelector: () => blocked ? {} : null,
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type) };
  let effect: () => (() => void) | undefined;
  const sandboxModule = { exports: {} as { default?: () => unknown } };
  const source = readFileSync(new URL("../components/navigation/NativeSwipeNavigation.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, window: b.win, document: doc, location: b.location, Element: Target, performance: { now: () => now },
    getComputedStyle: () => ({ overflowX: "auto" }),
    require: (name: string) => {
      if (name === "react") return { useEffect: (fn: typeof effect) => { effect = fn; }, useState: () => [null, () => {}] };
      if (name === "@capacitor/core") return { Capacitor: { isNativePlatform: () => native } };
      if (name === "@/lib/nativeSwipeHistory") return { installNativeSwipeHistory };
      if (name === "@/lib/nativeSwipeNavigation") return { edgeSwipeMovement, isSwipeAppPath, isSwipeEditingPath, startEdgeSwipe };
      if (name === "lucide-react" || name.endsWith(".css")) return {};
      if (name === "react/jsx-runtime") return { jsx: () => null };
      throw new Error("Unexpected component dependency " + name);
    },
  });
  sandboxModule.exports.default!(); const cleanup = effect!();
  const send = (type: string, x: number, y: number, target = new Target()) => {
    now += 100; const touch = { clientX: x, clientY: y }, event = { target, cancelable: true, defaultPrevented: false, touches: type === "touchend" ? [] : [touch], changedTouches: [touch], preventDefault() { this.defaultPrevented = true; } };
    listeners.get(type)?.(event); return event;
  };
  return { ...b, send, Target, listeners, block: (value: boolean) => { blocked = value; }, advance: () => { now += 1000; }, cleanup };
}

test("native touch listeners navigate in both directions; form controls, horizontal scrollers, modal forms and vertical movement retain control", () => {
  const b = mountedNavigation(); b.history.pushState({ __NA: true }, "", "/player/om");
  b.send("touchstart", 10, 300); assert.equal(b.send("touchmove", 110, 305).defaultPrevented, true); b.send("touchend", 110, 305);
  assert.equal(b.location.href, "https://activitee.app/player");
  b.advance(); b.send("touchstart", 380, 300); b.send("touchmove", 280, 300); b.send("touchend", 280, 300);
  assert.equal(b.location.href, "https://activitee.app/player/om");
  const control = new b.Target(); control.guarded = true;
  const scroll = new b.Target(); scroll.scrollWidth = 600; scroll.clientWidth = 300;
  for (const target of [control, scroll]) {
    b.advance(); b.send("touchstart", 10, 300, target); assert.equal(b.send("touchmove", 110, 300, target).defaultPrevented, false); b.send("touchend", 110, 300, target);
    assert.equal(b.location.href, "https://activitee.app/player/om");
  }
  b.block(true); b.advance(); b.send("touchstart", 10, 300); b.send("touchmove", 110, 300); b.send("touchend", 110, 300); b.block(false);
  assert.equal(b.location.href, "https://activitee.app/player/om");
  b.advance(); b.send("touchstart", 10, 300); assert.equal(b.send("touchmove", 12, 350).defaultPrevented, false); b.send("touchend", 110, 350);
  assert.equal(b.location.href, "https://activitee.app/player/om");
  b.cleanup!(); assert.equal(b.listeners.size, 0);
});

test("web browsers register no gesture handlers and keep their own history", () => {
  const b = mountedNavigation(false); assert.equal(b.listeners.size, 0);
  assert.equal(b.history.state.__activiteeSwipeHistory, undefined);
});


test("older native runtimes and unavailable session storage still support bounded in-memory navigation", () => {
  const b = browser();
  Object.defineProperty(b.win.crypto, "randomUUID", { value: undefined });
  Object.assign(b.win.sessionStorage, { getItem: () => { throw new Error("Storage unavailable"); }, setItem: () => { throw new Error("Storage unavailable"); }, removeItem: () => { throw new Error("Storage unavailable"); } });
  const tracker = installNativeSwipeHistory(b.win);
  b.history.pushState({ __NA: true }, "", "/player/om");
  assert.equal(tracker.navigate("back"), true);
  assert.equal(tracker.navigate("back"), false);
  assert.equal(tracker.navigate("forward"), true);
  tracker.dispose();
});
