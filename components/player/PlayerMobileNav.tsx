"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isActive(pathname: string, href: string) {
  if (href === "/player") return pathname === "/player";
  return pathname.startsWith(href);
}

export default function PlayerMobileNav() {
  const pathname = usePathname();

  const items = [
    { href: "/player", label: "Accueil", icon: HomeIcon, enabled: true },
    { href: "/player/calendar", label: "Calendrier", icon: CalendarIcon, enabled: false },
    { href: "/player/golf", label: "Mon Golf", icon: GolfIcon, enabled: false },
    { href: "/player/marketplace", label: "Marketplace", icon: TagIcon, enabled: true },
    { href: "/player/profile", label: "Mon profil", icon: UserIcon, enabled: true },
  ] as const;

  return (
    <nav className="mobile-nav" aria-label="Navigation principale">
      {items.map((it) => {
        const active = isActive(pathname, it.href);
        const Icon = it.icon;

        if (!it.enabled) {
          return (
            <button
              key={it.href}
              className={`mobile-nav-item ${active ? "active" : ""}`}
              type="button"
              disabled
              aria-disabled="true"
              title="Bientôt disponible"
            >
              <Icon />
              <span className="mobile-nav-label">{it.label}</span>
            </button>
          );
        }

        return (
          <Link
            key={it.href}
            href={it.href}
            className={`mobile-nav-item ${active ? "active" : ""}`}
          >
            <Icon />
            <span className="mobile-nav-label">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* Icons (inline SVG) */
function HomeIcon() {
  return (
    <svg className="mobile-nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 3 10v11h6v-6h6v6h6V10L12 3z" fill="currentColor" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg className="mobile-nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8H5v10h14V10z"
        fill="currentColor"
      />
    </svg>
  );
}
function GolfIcon() {
  return (
    <svg className="mobile-nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v12l6-3-6-3V2z" fill="currentColor" />
      <path d="M6 21c2.5-2 9.5-2 12 0v-2c-2.5-2-9.5-2-12 0v2z" fill="currentColor" />
      <path d="M12 14c-2.2 0-4 1.3-4 3s1.8 3 4 3 4-1.3 4-3-1.8-3-4-3z" fill="currentColor" opacity="0.18" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg className="mobile-nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.6 13.4 12 4.8V3H4v8h1.8l8.6 8.6a2 2 0 0 0 2.8 0l3.4-3.4a2 2 0 0 0 0-2.8zM7.5 9A1.5 1.5 0 1 1 9 7.5 1.5 1.5 0 0 1 7.5 9z"
        fill="currentColor"
      />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg className="mobile-nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2-8 4.5V21h16v-2.5C20 16 16.4 14 12 14z"
        fill="currentColor"
      />
    </svg>
  );
}
