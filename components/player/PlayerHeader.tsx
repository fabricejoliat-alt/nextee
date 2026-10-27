"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PlayerDesktopDrawer from "@/components/player/PlayerDesktopDrawer";
import { Bell, Menu } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PushActivationBanner from "@/components/notifications/PushActivationBanner";
import { applyPwaBadge, getUnreadNotificationsCount } from "@/lib/notifications";
import { ensurePushSubscription, supportsWebPush } from "@/lib/pushClient";
import { supabase } from "@/lib/supabaseClient";

export default function PlayerHeader() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    let mounted = true;

    async function loadUnread() {
      const authRes = await supabase.auth.getSession();
      const userId = authRes.data.session?.user.id;
      if (!userId || !mounted) return;
      try {
        const count = await getUnreadNotificationsCount(userId, { hideThreadNotifications: true, role: "player" });
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
    const onNotificationsChanged = (event: Event) => {
      const custom = event as CustomEvent<{ unreadCount?: number }>;
      const next = custom.detail?.unreadCount;
      if (typeof next === "number" && Number.isFinite(next)) {
        setUnreadCount(Math.max(0, next));
        applyPwaBadge(Math.max(0, next));
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("notifications:changed", onNotificationsChanged);
    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("notifications:changed", onNotificationsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!supportsWebPush()) return;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const result = await ensurePushSubscription({ prompt: false }).catch(() => null);
      if (cancelled || !result?.ok) return;
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const authRes = await supabase.auth.getSession();
      const userId = authRes.data.session?.user.id;
      if (!userId || cancelled) return;

      channel = supabase
        .channel(`player-header-notifications-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notification_recipients",
            filter: `user_id=eq.${userId}`,
          },
          async () => {
            const count = await getUnreadNotificationsCount(userId, { hideThreadNotifications: true, role: "player" }).catch(() => 0);
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

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-grid app-header-grid--centered">
            {/* LEFT: Burger */}
            <div className="header-left header-left--icon">
              <button
                className="icon-btn"
                type="button"
                aria-label={open ? t("common.close") : t("common.openMenu")}
                aria-expanded={open}
                aria-controls="player-navigation-drawer"
                onClick={() => setOpen(current => !current)}
              >
                <Menu size={22} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            {/* CENTER: Logo */}
            <div className="header-center header-center--brand">
              <Link href="/player" className="brand" aria-label="ActiviTee - Accueil">
                <span className="brand-nex">Activi</span>
                <span className="brand-tee">Tee</span>
              </Link>
            </div>

            {/* RIGHT: Bell */}
            <div className="header-right header-right--icon">
              <Link className="icon-btn icon-btn-notifications" href="/player/notifications" aria-label={t("notifications.settings.notifications")}>
                <Bell size={22} strokeWidth={2} aria-hidden="true" />
                {unreadCount > 0 ? <span className="icon-btn-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <PushActivationBanner settingsHref="/player/notifications/settings" />

      {/* Drawer (désormais utilisable aussi en mobile/app via CSS) */}
      <PlayerDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
