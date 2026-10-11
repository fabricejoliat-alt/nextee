"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Dumbbell, Flag, Plus, ShoppingBag, User } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

function scrollTop() {
  // 1) Si tu as un conteneur scrollable, adapte ici (priorité)
  const candidates = [
    document.querySelector(".app-shell"),
    document.querySelector("main"),
    document.querySelector("[data-scroll-container]"),
  ].filter(Boolean) as HTMLElement[];

  // scroll container (si existe)
  for (const el of candidates) {
    if (el && el.scrollTop > 0) el.scrollTo({ top: 0, left: 0, behavior: "auto" });
    // même si scrollTop==0, on force quand même (au cas où)
    el.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  // 2) Fallback document/window
  document.documentElement.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.body.scrollTo({ top: 0, left: 0, behavior: "auto" });
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

export default function MobileFooter() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!quickActionsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setQuickActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuickActionsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [quickActionsOpen]);

  // Après navigation (quand la nouvelle page est montée)
  useEffect(() => {
    // double raf = plus fiable sur certains layouts / transitions
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setQuickActionsOpen(false);
      scrollTop();
    }));
  }, [pathname]);

  const items = [
    { href: "/player/golf/trainings?type=all", label: t("player.activities"), Icon: CalendarDays },
    { href: "/player/golf", label: t("player.myGolf"), Icon: Flag },
    { href: "/player/marketplace", label: t("nav.marketplace"), Icon: ShoppingBag },
    { href: "/player/profile", label: t("nav.profile"), Icon: User },
  ];

  function isActive(path: string, href: string) {
    const hrefPath = href.split("?")[0] || href;
    if (hrefPath === "/player/golf/trainings") return path === hrefPath || path.startsWith(hrefPath + "/");
    if (hrefPath === "/player/golf") {
      const inGolf = path === hrefPath || path.startsWith(hrefPath + "/");
      const inTrainings = path === "/player/golf/trainings" || path.startsWith("/player/golf/trainings/");
      return inGolf && !inTrainings;
    }
    return path === hrefPath || path.startsWith(hrefPath + "/");
  }

  return (
    <nav ref={navRef} className="mobile-nav player-mobile-nav" aria-label={t("common.navigation")}>
      {items.slice(0, 2).map(({ href, label, Icon }) => (
        <Link key={href} href={href} className={`mobile-nav-item ${isActive(pathname, href) ? "active" : ""}`} aria-current={isActive(pathname, href) ? "page" : undefined} onClick={() => { setQuickActionsOpen(false); scrollTop(); }}>
          <Icon aria-hidden="true" />
          <span className="mobile-nav-label">{label}</span>
        </Link>
      ))}
      <button type="button" className={`mobile-nav-item player-nav-add${quickActionsOpen ? " active" : ""}`} aria-label={t("common.add")} aria-haspopup="menu" aria-expanded={quickActionsOpen} aria-controls="player-quick-actions" onClick={() => setQuickActionsOpen((open) => !open)}>
        <Plus aria-hidden="true" />
      </button>
      {items.slice(2).map(({ href, label, Icon }) => (
        <Link key={href} href={href} className={`mobile-nav-item ${isActive(pathname, href) ? "active" : ""}`} aria-current={isActive(pathname, href) ? "page" : undefined} onClick={() => { setQuickActionsOpen(false); scrollTop(); }}>
          <Icon aria-hidden="true" />
          <span className="mobile-nav-label">{label}</span>
        </Link>
      ))}
      {quickActionsOpen && (
        <div id="player-quick-actions" className="player-quick-actions" role="menu" aria-label={t("common.add")}>
          <Link href="/player/golf/trainings/new" role="menuitem" onClick={() => setQuickActionsOpen(false)}>
            <Dumbbell aria-hidden="true" />{t("player.newTraining")}
          </Link>
          <Link href="/player/golf/rounds/new" role="menuitem" onClick={() => setQuickActionsOpen(false)}>
            <Flag aria-hidden="true" />{t("player.newRound")}
          </Link>
        </div>
      )}
    </nav>
  );
}
