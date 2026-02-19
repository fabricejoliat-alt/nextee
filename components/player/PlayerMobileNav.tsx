"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Home, CalendarDays, Flag, ShoppingBag, User } from "lucide-react";

export default function MobileFooter() {
  const pathname = usePathname();

  useEffect(() => {
    // Force la page à revenir en haut à chaque navigation
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
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
          >
            <Icon aria-hidden="true" />
            <div className="mobile-nav-label">{label}</div>
          </Link>
        );
      })}
    </nav>
  );
}