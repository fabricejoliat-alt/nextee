"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Home, CalendarDays, Flag, ShoppingBag, User } from "lucide-react";
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
  const { t, locale } = useI18n();

  // Après navigation (quand la nouvelle page est montée)
  useEffect(() => {
    // double raf = plus fiable sur certains layouts / transitions
    requestAnimationFrame(() => requestAnimationFrame(scrollTop));
  }, [pathname]);

  const items = [
    { href: "/player", label: t("nav.home"), Icon: Home },
    { href: "/player/golf/trainings?type=all", label: locale === "fr" ? "Mon activité" : "My activity", Icon: CalendarDays },
    { href: "/player/golf", label: t("player.myGolf"), Icon: Flag },
    { href: "/player/marketplace", label: t("nav.marketplace"), Icon: ShoppingBag },
    { href: "/player/profile", label: t("nav.profile"), Icon: User },
  ];

  function isActive(path: string, href: string) {
    const hrefPath = href.split("?")[0] || href;
    if (hrefPath === "/player") return path === "/player";
    if (hrefPath === "/player/golf/trainings") return path === hrefPath || path.startsWith(hrefPath + "/");
    if (hrefPath === "/player/golf") {
      const inGolf = path === hrefPath || path.startsWith(hrefPath + "/");
      const inTrainings = path === "/player/golf/trainings" || path.startsWith("/player/golf/trainings/");
      return inGolf && !inTrainings;
    }
    return path === hrefPath || path.startsWith(hrefPath + "/");
  }

  return (
    <nav className="mobile-nav" aria-label={t("common.navigation")}>
      {items.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={`mobile-nav-item ${active ? "active" : ""}`}
            onClick={() => scrollTop()}   // ✅ au clic
          >
            <Icon aria-hidden="true" />
            <div className="mobile-nav-label">{label}</div>
          </Link>
        );
      })}
    </nav>
  );
}
