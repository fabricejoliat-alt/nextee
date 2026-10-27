import { isSwipeAppPath, type SwipeDirection } from "./nativeSwipeNavigation.ts";

const STORAGE_KEY = "activitee:swipe-history:v1";
const STATE_KEY = "__activiteeSwipeHistory";
type Ledger = { session: string; index: number; max: number };
type Stamp = { session: string; index: number };
function validStamp(value: unknown): value is Stamp {
  const stamp = value as Stamp | null;
  return Boolean(stamp && typeof stamp.session === "string" && Number.isSafeInteger(stamp.index) && stamp.index >= 0);
}
function record(value: unknown): Record<string, unknown> | null {
  return value == null ? {} : typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Preserve Next's history state; gestures can only traverse entries we own. */
export function installNativeSwipeHistory(win: Window, onChange: () => void = () => {}) {
  const history = win.history, push = history.pushState, replace = history.replaceState;
  let ledger: Ledger | null = null, active = true;
  const eligible = (url: string | URL | null | undefined) => {
    try { const next = new URL(url == null ? win.location.href : String(url), win.location.href); return next.origin === win.location.origin && isSwipeAppPath(next.pathname); } catch { return false; }
  };
  const fresh = (): Ledger => ({ session: win.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, index: 0, max: 0 });
  const persist = () => { try { if (ledger) win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); else win.sessionStorage.removeItem(STORAGE_KEY); } catch { /* In-memory history still works when storage is unavailable. */ } };
  const stamped = (data: unknown, next: Ledger) => ({ ...record(data), [STATE_KEY]: { session: next.session, index: next.index } });
  const current = () => {
    const stamp = record(history.state)?.[STATE_KEY];
    return ledger && validStamp(stamp) && stamp.session === ledger.session && stamp.index === ledger.index;
  };
  if (eligible(win.location.href) && record(history.state)) {
    try {
      const saved = JSON.parse(win.sessionStorage.getItem(STORAGE_KEY) ?? "null") as Ledger | null;
      const stamp = record(history.state)?.[STATE_KEY];
      if (saved && validStamp(stamp) && saved.session === stamp.session && Number.isSafeInteger(saved.max) && stamp.index <= saved.max) ledger = { ...saved, index: stamp.index };
    } catch { /* Start a bounded history instead. */ }
    ledger ??= fresh(); replace.call(history, stamped(history.state, ledger), "", win.location.href); persist();
  }
  const pushState: History["pushState"] = function (data, unused, url) {
    if (!active) return push.call(history, data, unused, url);
    const next = eligible(url) && record(data) ? current() && ledger ? { ...ledger, index: ledger.index + 1, max: ledger.index + 1 } : fresh() : null;
    push.call(history, next ? stamped(data, next) : data, unused, url);
    ledger = next; persist(); onChange();
  };
  const replaceState: History["replaceState"] = function (data, unused, url) {
    if (!active) return replace.call(history, data, unused, url);
    const next = eligible(url) && record(data) ? current() && ledger ? ledger : fresh() : null;
    replace.call(history, next ? stamped(data, next) : data, unused, url);
    ledger = next; persist(); onChange();
  };
  const pop = () => {
    const stamp = record(history.state)?.[STATE_KEY];
    if (eligible(win.location.href) && ledger && validStamp(stamp) && stamp.session === ledger.session && stamp.index <= ledger.max) ledger.index = stamp.index;
    else {
      ledger = eligible(win.location.href) && record(history.state) ? fresh() : null;
      if (ledger) replace.call(history, stamped(history.state, ledger), "", win.location.href);
    }
    persist(); onChange();
  };
  const pagehide = () => { if (ledger) ledger.max = ledger.index; persist(); onChange(); };
  win.addEventListener("pagehide", pagehide);
  history.pushState = pushState; history.replaceState = replaceState; win.addEventListener("popstate", pop);
  return {
    canNavigate(direction: SwipeDirection) { return Boolean(current() && ledger && (direction === "back" ? ledger.index > 0 : ledger.index < ledger.max)); },
    navigate(direction: SwipeDirection) { if (!this.canNavigate(direction)) return false; if (direction === "back") history.back(); else history.forward(); return true; },
    dispose() {
      active = false; win.removeEventListener("popstate", pop); win.removeEventListener("pagehide", pagehide);
      if (history.pushState === pushState) history.pushState = push;
      if (history.replaceState === replaceState) history.replaceState = replace;
    },
  };
}
