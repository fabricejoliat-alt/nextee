import test from "node:test";
import assert from "node:assert/strict";
import { installPageScrollRestoration, CLEAR_PRESERVED_PAGES_EVENT } from "../lib/pageScrollRestoration.ts";

function environment() {
  const listeners = new Map<string, Set<() => void>>();
  const add = (key: string, fn: () => void) => { const set = listeners.get(key) ?? new Set(); set.add(fn); listeners.set(key, set); };
  const remove = (key: string, fn: () => void) => listeners.get(key)?.delete(fn);
  const emit = (key: string) => listeners.get(key)?.forEach(fn => fn());
  let resized = () => {};
  class ResizeMock { constructor(fn: () => void) { resized = fn; } observe() {} disconnect() {} }
  Object.assign(globalThis, { ResizeObserver: ResizeMock });
  let frameId = 0;
  const frames = new Map<number, () => void>();
  const hidden = { getClientRects: () => [], scrollTop: 999, scrollLeft: 0, scrollTo() { throw new Error("Hidden pages must never be scrolled"); } };
  const area = { max: 3000, scrollTop: 0, scrollLeft: 0, getClientRects: () => [{}], scrollTo({ left, top }: { left: number; top: number }) { this.scrollLeft = left; this.scrollTop = Math.min(this.max, top); } };
  const win = { location: { href: "https://activitee.app/player/golf/trainings?type=all" }, history: { scrollRestoration: "auto" }, scrollX: 0, scrollY: 0,
    document: { querySelectorAll: (selector: string) => selector === "main" ? [area] : [hidden, area], addEventListener: add, removeEventListener: remove },
    addEventListener: add, removeEventListener: remove, scrollTo({ left, top }: { left: number; top: number }) { this.scrollX = left; this.scrollY = top; },
    requestAnimationFrame: (fn: () => void) => { const id = ++frameId; frames.set(id, fn); return id; }, cancelAnimationFrame: (id: number) => frames.delete(id), setTimeout: () => 1, clearTimeout() {},
  };
  const controller = installPageScrollRestoration(win as unknown as Window);
  const flush = () => { for (let i = 0; i < 10 && frames.size; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); } };
  const navigate = (path: string, pop = false) => { emit("click"); win.location.href = new URL(path, win.location.href).href; if (pop) emit("popstate"); controller.commit(win.location.href); flush(); };
  return { win, area, emit, navigate, flush, resize: () => resized(), controller };
}

test("Back and Forward restore container and window positions; new routes start at the top", () => {
  const e = environment(); e.area.scrollTop = 1234; e.win.scrollY = 88; e.emit("scroll");
  e.navigate("/player/om"); assert.equal(e.area.scrollTop, 0);
  e.area.scrollTop = 230; e.emit("scroll");
  e.navigate("/player/golf/trainings?type=all", true); assert.equal(e.area.scrollTop, 1234); assert.equal(e.win.scrollY, 88);
  e.navigate("/player/om", true); assert.equal(e.area.scrollTop, 230);
  e.controller.dispose(); assert.equal(e.win.history.scrollRestoration, "auto");
});
test("restoration waits for content height and gives control back to a user gesture", () => {
  const e = environment(); e.area.scrollTop = 1234; e.emit("scroll"); e.navigate("/player/om");
  e.area.max = 200; e.navigate("/player/golf/trainings?type=all", true); assert.equal(e.area.scrollTop, 200);
  e.area.max = 3000; e.resize(); e.flush(); assert.equal(e.area.scrollTop, 1234);
  e.navigate("/player/om"); e.area.max = 200; e.navigate("/player/golf/trainings?type=all", true); e.emit("touchstart");
  e.area.max = 3000; e.resize(); e.flush(); assert.equal(e.area.scrollTop, 200);
  e.controller.dispose();
});
test("query scopes keep separate positions, and account changes clear the saved state", () => {
  const e = environment(); e.area.scrollTop = 456; e.emit("scroll");
  e.navigate("/player/golf/trainings?type=all&child_id=other"); e.area.scrollTop = 789; e.emit("scroll"); e.navigate("/player/om");
  e.navigate("/player/golf/trainings?type=all", true); assert.equal(e.area.scrollTop, 456);
  e.navigate("/player/golf/trainings?type=all&child_id=other", true); assert.equal(e.area.scrollTop, 789);
  e.navigate("/player/om"); e.emit(CLEAR_PRESERVED_PAGES_EVENT); e.navigate("/player/golf/trainings?type=all", true); assert.equal(e.area.scrollTop, 0);
  e.controller.dispose();
});

test("restores even when the router commits before our popstate listener", () => {
  const e = environment(); e.area.scrollTop = 567; e.emit("scroll"); e.navigate("/player/om");
  e.win.location.href = "https://activitee.app/player/golf/trainings?type=all";
  e.controller.commit(e.win.location.href); // Synchronous router callback.
  e.emit("popstate"); e.flush();
  assert.equal(e.area.scrollTop, 567); e.controller.dispose();
});

test("explicit section anchors and public pages retain the browser's usual behavior", () => {
  const e = environment(); e.area.scrollTop = 200; e.emit("scroll");
  e.navigate("/player/golf#training-volume"); assert.equal(e.area.scrollTop, 200);
  e.navigate("/legal/privacy"); assert.equal(e.win.history.scrollRestoration, "auto");
  e.navigate("/player"); assert.equal(e.win.history.scrollRestoration, "manual");
  e.controller.dispose();
});
