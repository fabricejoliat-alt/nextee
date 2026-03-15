"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import CoachDesktopDrawer from "@/components/coach/CoachDesktopDrawer";
import LanguageToggle from "@/components/i18n/LanguageToggle";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { applyPwaBadge, getUnreadNotificationsCount } from "@/lib/notifications";
import { ensurePushSubscription, supportsWebPush } from "@/lib/pushClient";
import { supabase } from "@/lib/supabaseClient";

function BurgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 7h16v2H4V7Zm0 6h16v2H4v-2Zm0 6h16v2H4v-2Z"
        opacity="0.95"
      />
    </svg>
  );
}

export default function CoachHeader() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    let mounted = true;

    async function loadUnread() {
      const authRes = await supabase.auth.getUser();
      const userId = authRes.data.user?.id;
      if (!userId || !mounted) return;
      try {
        const count = await getUnreadNotificationsCount(userId);
        if (!mounted) return;
        setUnreadCount(count);
        applyPwaBadge(count);
      } catch {
        if (!mounted) return;
        setUnreadCount(0);
      }

    }

    loadUnread();
    const onFocus = () => loadUnread();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadUnread();
    };
    const onNotificationsChanged = (event: Event) => {
      const custom = event as CustomEvent<{ unreadCount?: number }>;
      const next = custom.detail?.unreadCount;
      if (typeof next === "number" && Number.isFinite(next)) {
        setUnreadCount(Math.max(0, next));
        applyPwaBadge(Math.max(0, next));
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("notifications:changed", onNotificationsChanged);
    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("notifications:changed", onNotificationsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const authRes = await supabase.auth.getUser();
      const userId = authRes.data.user?.id;
      if (!userId || cancelled) return;

      channel = supabase
        .channel(`coach-header-notifications-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notification_recipients",
            filter: `user_id=eq.${userId}`,
          },
          async () => {
            const count = await getUnreadNotificationsCount(userId).catch(() => 0);
            if (cancelled) return;
            setUnreadCount(count);
            applyPwaBadge(count);
            window.dispatchEvent(new CustomEvent("notifications:changed", { detail: { unreadCount: count } }));
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const ensureSubscription = async () => {
      if (!supportsWebPush()) return;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const result = await ensurePushSubscription({ prompt: false }).catch(() => null);
      if (cancelled || !result?.ok) return;
    };

    void ensureSubscription();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void ensureSubscription();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-grid app-header-grid--centered">
            <div className="header-left header-left--icon">
              <button className="icon-btn" type="button" aria-label={t("common.openMenu")} onClick={() => setOpen(true)}>
                <BurgerIcon />
              </button>
            </div>

            <div className="header-center header-center--brand">
              <Link href="/coach" className="brand" aria-label="ActiviTee - Coach">
                <span className="brand-nex">Activi</span>
                <span className="brand-tee">Tee</span>
              </Link>
            </div>

            <div className="header-right header-right--icon">
              <LanguageToggle />
              <Link className="icon-btn icon-btn-notifications" href="/coach/notifications" aria-label={t("common.notificationsSoon")}>
                <Bell size={22} strokeWidth={2} aria-hidden="true" />
                {unreadCount > 0 ? <span className="icon-btn-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <CoachDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
