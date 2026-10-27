import { Capacitor, registerPlugin } from "@capacitor/core";
import { installNativeSwipeHistory } from "./nativeSwipeHistory.ts";

export type IOSSwipePolicy = {
  href: string;
  enabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};
const plugin = registerPlugin<{ setPolicy(policy: IOSSwipePolicy): Promise<void> }>("NativeSwipeNavigation");

export function supportsIOSSwipeNavigation() {
  return Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("NativeSwipeNavigation");
}

/** New iOS shells own the gesture and its interactive WebKit transition.
 * Old shells retain the existing JS gesture until they receive a native update.
 */
export function installIOSSwipeNavigation(win: Window, blocked: () => boolean) {
  let active = true, queued = false, lastPolicy = "";
  const refresh = () => {
    if (!active) return;
    const policy: IOSSwipePolicy = {
      href: win.location.href,
      enabled: !blocked(),
      canGoBack: history.canNavigate("back"),
      canGoForward: history.canNavigate("forward"),
    };
    const key = JSON.stringify(policy);
    if (key === lastPolicy) return;
    lastPolicy = key;
    // Native defaults to disabled. A failed bridge must never install a second gesture.
    void plugin.setPolicy(policy).catch(() => { if (lastPolicy === key) lastPolicy = ""; });
  };
  const schedule = () => {
    if (!active || queued) return;
    queued = true;
    win.queueMicrotask(() => { queued = false; refresh(); });
  };
  const history = installNativeSwipeHistory(win, schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(win.document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["open", "role", "aria-modal", "data-swipe-navigation", "contenteditable"],
  });
  win.document.addEventListener("focusin", schedule);
  win.document.addEventListener("focusout", schedule);
  win.addEventListener("pageshow", schedule);
  refresh();
  return () => {
    active = false;
    observer.disconnect(); history.dispose();
    win.document.removeEventListener("focusin", schedule);
    win.document.removeEventListener("focusout", schedule);
    win.removeEventListener("pageshow", schedule);
    void plugin.setPolicy({ href: win.location.href, enabled: false, canGoBack: false, canGoForward: false }).catch(() => {});
  };
}
