"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PlayerDesktopDrawer from "@/components/player/PlayerDesktopDrawer";
import { Bell } from "lucide-react";
import LanguageToggle from "@/components/i18n/LanguageToggle";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { applyPwaBadge, getUnreadNotificationsCount } from "@/lib/notifications";
import { supabase } from "@/lib/supabaseClient";
import { ensurePushSubscription } from "@/lib/pushClient";

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

export default function PlayerHeader() {
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

      ensurePushSubscription({ prompt: false }).catch(() => {});
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
    if (typeof window === "undefined") return;
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const isMobile = window.matchMedia?.("(max-width: 899px)").matches;

    // Web mobile browser only (do not impact installed app)
    if (isStandalone || !isMobile) return;

    let lastY = window.scrollY;
    let ticking = false;

    const apply = () => {
      const y = window.scrollY;
      const headerEl = document.querySelector(".app-header");
      const navEl = document.querySelector(".mobile-nav");
      if (!headerEl || !navEl) return;

      const nearTop = y < 12;
      if (nearTop || y < lastY) {
        headerEl.classList.remove("hidden");
        navEl.classList.remove("hidden");
      } else if (y > lastY + 4) {
        headerEl.classList.add("hidden");
        navEl.classList.add("hidden");
      }
      lastY = y;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        apply();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      const headerEl = document.querySelector(".app-header");
      const navEl = document.querySelector(".mobile-nav");
      headerEl?.classList.remove("hidden");
      navEl?.classList.remove("hidden");
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
                aria-label={t("common.openMenu")}
                onClick={() => setOpen(true)}
              >
                <BurgerIcon />
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
              <LanguageToggle />
              <Link className="icon-btn icon-btn-notifications" href="/player/notifications" aria-label={t("common.notificationsSoon")}>
                <Bell size={22} strokeWidth={2} aria-hidden="true" />
                {unreadCount > 0 ? <span className="icon-btn-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Drawer (désormais utilisable aussi en mobile/app via CSS) */}
      <PlayerDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
