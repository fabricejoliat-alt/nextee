"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadMyNotificationPreferences } from "@/lib/notificationPreferences";
import { clearNativePushSession, ensureNativePush, listenToNativePush, supportsNativePush, syncNativeBadge } from "@/lib/nativePush";

export default function NativePushLifecycle() {
  const router = useRouter();
  useEffect(() => {
    if (!supportsNativePush()) return;
    let active = true;
    let removeListeners: (() => void) | undefined;
    let badgeTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshBadge = () => {
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => { if (active) void syncNativeBadge().catch(() => {}); }, 50);
    };
    void listenToNativePush(path => router.push(path)).then(remove => {
      if (active) removeListeners = remove; else remove();
    }).catch(() => {});
    const sync = async () => {
      refreshBadge();
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId || !active) return;
      const prefs = await loadMyNotificationPreferences(userId);
      if (active && prefs.receiveInApp && prefs.receivePush) await ensureNativePush({ prompt: false });
    };
    const refresh = () => { if (document.visibilityState === "visible") void sync().catch(() => {}); };
    const { data: auth } = supabase.auth.onAuthStateChange(event => {
      // Defer auth reads outside Supabase's auth callback lock.
      if (event === "SIGNED_OUT") void clearNativePushSession().catch(() => {});
      else if (event === "SIGNED_IN") setTimeout(refresh, 0);
    });
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("notifications:changed", refreshBadge);
    window.addEventListener("notifications:badge-refresh", refreshBadge);
    return () => {
      active = false; removeListeners?.(); auth.subscription.unsubscribe();
      clearTimeout(badgeTimer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("notifications:changed", refreshBadge);
      window.removeEventListener("notifications:badge-refresh", refreshBadge);
    };
  }, [router]);
  return null;
}
