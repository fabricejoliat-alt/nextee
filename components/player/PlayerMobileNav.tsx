"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Home, CalendarDays, Flag, ShoppingBag, User } from "lucide-react";

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

  // Après navigation (quand la nouvelle page est montée)
  useEffect(() => {
    // double raf = plus fiable sur certains layouts / transitions
    requestAnimationFrame(() => requestAnimationFrame(scrollTop));
  }, [pathname]);

  const items = [
    { href: "/player", label: "Accueil", Icon: Home },
    { href: "/player/calendar", label: "Calendrier", Icon: CalendarDays },
    { href: "/player/golf", label: "Mon Golf", Icon: Flag },
    { href: "/player/marketplace", label: "Marketplace", Icon: ShoppingBag },
    { href: "/player/profile", label: "Profil", Icon: User },
  ];

  return (
    <nav className="mobile-nav" aria-label="Navigation principale">
      {items.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
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