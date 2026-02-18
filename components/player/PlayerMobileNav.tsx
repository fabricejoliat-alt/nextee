"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isActive(pathname: string, href: string) {
  if (href === "/player") return pathname === "/player";
  return pathname.startsWith(href);
}

function IconHome() {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3 3 10v11h6v-7h6v7h6V10l-9-7Z"
      />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 2h2v2h6V2h2v2h3v18H2V4h5V2Zm13 8H4v10h16V10Z"
      />
    </svg>
  );
}

function IconGolf() {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 3v18H6v2h6v-2H10V7.2l8-2.6L8 3Zm7 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        opacity="0.95"
      />
    </svg>
  );
}

function IconShop() {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 4h10l1 4H6l1-4Zm-2 6h14v10H5V10Zm4 3v2h6v-2H9Z"
      />
    </svg>
  );
}

function IconUser() {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-5 0-9 2.7-9 6v2h18v-2c0-3.3-4-6-9-6Z"
      />
    </svg>
  );
}

export default function PlayerMobileNav() {
  const pathname = usePathname();

  const items = [
    { href: "/player", label: "Accueil", icon: <IconHome /> },
    { href: "/player/calendar", label: "Calendrier", icon: <IconCalendar /> },
    { href: "/player/golf", label: "Mon Golf", icon: <IconGolf /> },
    { href: "/player/marketplace", label: "Marketplace", icon: <IconShop /> },
    { href: "/player/profile", label: "Profil", icon: <IconUser /> },
  ] as const;

  return (
    <nav className="mobile-nav" aria-label="Navigation principale">
      <div className="mobile-nav-inner">
        {items.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <Link key={it.href} href={it.href} className={active ? "active" : ""}>
              {it.icon}
              <div>{it.label}</div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
