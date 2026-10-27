export const CLEAR_PRESERVED_PAGES_EVENT = "activitee:clear-preserved-pages";
type Position = { window: [number, number]; containers: Array<[number, number]> };
const appPath = (url: URL) => /^\/(player|parent|coach|manager|admin)(\/|$)/.test(url.pathname);
const containersSelector = "[data-scroll-container],.manager-scroll-area,.parent-scroll-area,.admin-scroll-area";

/** Restore app-owned scrolling containers as well as the browser viewport.
 * Positions live only in this document and are cleared on authentication changes.
 */
export function installPageScrollRestoration(win: Window) {
  const positions = new Map<string, Position>();
  let current = win.location.href, pending: string | null = null, restoring = false;
  let stopRestore = () => {};
  const previousMode = win.history.scrollRestoration;
  win.history.scrollRestoration = appPath(new URL(current)) ? "manual" : previousMode;
  const containers = () => Array.from(win.document.querySelectorAll<HTMLElement>(containersSelector)).filter(el => el.getClientRects().length > 0);
  const save = () => {
    if (restoring || !appPath(new URL(current))) return;
    positions.delete(current);
    positions.set(current, { window: [win.scrollX, win.scrollY], containers: containers().map(el => [el.scrollLeft, el.scrollTop]) });
    if (positions.size > 100) positions.delete(positions.keys().next().value!);
  };
  let popFrame = 0;
  const pop = () => {
    const href = win.location.href;
    pending = href;
    // A router can commit synchronously before later popstate listeners run.
    // Cover that order as well as the usual event-before-render order.
    win.cancelAnimationFrame(popFrame);
    popFrame = win.requestAnimationFrame(() => {
      if (pending === href && win.location.href === href) controller.commit(href);
    });
  };
  const clear = () => { positions.clear(); pending = null; stopRestore(); };
  win.document.addEventListener("scroll", save, { capture: true, passive: true });
  // Capture before a Link changes the route, even if the user hasn't scrolled.
  win.document.addEventListener("click", save, true);
  win.addEventListener("popstate", pop, true);
  win.addEventListener(CLEAR_PRESERVED_PAGES_EVENT, clear);

  const controller = {
    commit(href: string) {
      if (href === current && pending !== href) return;
      const previous = new URL(current);
      current = href;
      stopRestore();
      const position = pending === href ? positions.get(href) : undefined;
      const isHistory = pending === href;
      pending = null;
      if (!appPath(new URL(href))) { win.history.scrollRestoration = previousMode; return; }
      win.history.scrollRestoration = "manual";
      // Let the router honor explicit section anchors on ordinary navigation.
      if (!isHistory && new URL(href).hash) return;
      // Search/filter changes on the current page retain their own scroll.
      if (!isHistory && previous.pathname === new URL(href).pathname) return;
      restoring = true;
      let frame = 0, timeout = 0, stopped = false;
      const cancel = () => {
        if (stopped) return;
        stopped = true; restoring = false;
        win.cancelAnimationFrame(frame); win.clearTimeout(timeout); observer.disconnect();
        win.document.removeEventListener("touchstart", cancel, true);
        win.document.removeEventListener("pointerdown", cancel, true);
        win.document.removeEventListener("wheel", cancel, true);
      };
      const apply = () => {
        if (stopped) return;
        const targets = containers();
        targets.forEach((element, index) => {
          const [left, top] = position?.containers[index] ?? [0, 0];
          element.scrollTo({ left, top, behavior: "instant" });
        });
        const [left, top] = position?.window ?? [0, 0];
        win.scrollTo({ left, top, behavior: "instant" });
        const ready = targets.length >= (position?.containers.length ?? 0) && targets.every((el, index) => el.scrollTop >= (position?.containers[index]?.[1] ?? 0) - 1)
          && win.scrollY >= top - 1;
        if (ready) {
          // One further frame wins over the router's own scroll/focus pass.
          frame = win.requestAnimationFrame(() => { if (!stopped) { targets.forEach((el, i) => { const [x, y] = position?.containers[i] ?? [0, 0]; el.scrollTo({ left: x, top: y, behavior: "instant" }); }); win.scrollTo({ left, top, behavior: "instant" }); cancel(); } });
        }
      };
      const observer = new ResizeObserver(() => { win.cancelAnimationFrame(frame); frame = win.requestAnimationFrame(apply); });
      // A fixed-height scrolling area does not resize when its content loads.
      for (const element of win.document.querySelectorAll("main")) observer.observe(element);
      win.document.addEventListener("touchstart", cancel, { capture: true, passive: true });
      win.document.addEventListener("pointerdown", cancel, { capture: true, passive: true });
      win.document.addEventListener("wheel", cancel, { capture: true, passive: true });
      timeout = win.setTimeout(cancel, 5000);
      stopRestore = cancel;
      apply();
    },
    dispose() {
      stopRestore(); win.cancelAnimationFrame(popFrame); positions.clear(); win.history.scrollRestoration = previousMode;
      win.document.removeEventListener("scroll", save, true); win.document.removeEventListener("click", save, true);
      win.removeEventListener("popstate", pop, true); win.removeEventListener(CLEAR_PRESERVED_PAGES_EVENT, clear);
    },
  };
  return controller;
}
