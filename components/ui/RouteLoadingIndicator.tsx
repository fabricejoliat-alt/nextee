"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function isInternalNavigationClick(event: MouseEvent) {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const target = event.target as HTMLElement | null;
  const anchor = target?.closest("a") as HTMLAnchorElement | null;
  if (!anchor) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  const href = anchor.getAttribute("href") ?? "";
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    try {
      const url = new URL(href);
      if (url.origin !== window.location.origin) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export default function RouteLoadingIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = useMemo(() => `${pathname ?? ""}?${searchParams?.toString() ?? ""}`, [pathname, searchParams]);

  const [visible, setVisible] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const startLoading = () => {
    clearTimers();
    startedAtRef.current = Date.now();
    // Évite le flash si la navigation est instantanée.
    showTimerRef.current = window.setTimeout(() => {
      setVisible(true);
    }, 120);
  };

  const stopLoading = () => {
    clearTimers();
    const startedAt = startedAtRef.current;
    const minVisibleMs = 260;
    const elapsed = startedAt ? Date.now() - startedAt : minVisibleMs;
    const wait = Math.max(0, minVisibleMs - elapsed);

    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      startedAtRef.current = null;
    }, wait);
  };

  useEffect(() => {
    stopLoading();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!isInternalNavigationClick(event)) return;
      startLoading();
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null;
      if (!form) return;
      const method = (form.method || "get").toLowerCase();
      if (method !== "get" && method !== "post") return;
      startLoading();
    };

    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);

    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit, true);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <div className="route-loading-overlay" aria-live="polite" aria-busy="true">
      <div className="route-loading-spinner" />
      <div className="route-loading-text">Chargement…</div>
    </div>
  );
}

