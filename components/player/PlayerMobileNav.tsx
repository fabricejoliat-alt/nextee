"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; disabled?: boolean };

const TABS: Tab[] = [
  { href: "/player", label: "Accueil" },
  { href: "/player/calendar", label: "Calendrier", disabled: true },
  { href: "/player/golf", label: "Mon Golf" },
  { href: "/player/marketplace", label: "Marketplace" },
  { href: "/player/profile", label: "Profil" },
];

function Icon({ name, active }: { name: Tab["label"]; active: boolean }) {
  const stroke = active ? "var(--text)" : "var(--muted)";
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  // Icônes ultra simples, sans style iOS
  if (name === "Accueil") {
    return (
      <svg {...common}>
        <path d="M3 10.5L12 3l9 7.5" />
        <path d="M5 10v10h14V10" />
      </svg>
    );
  }

  if (name === "Calendrier") {
    return (
      <svg {...common}>
        <path d="M7 3v3M17 3v3" />
        <path d="M4 7h16" />
        <rect x="4" y="6" width="16" height="15" rx="2" />
      </svg>
    );
  }

  if (name === "Mon Golf") {
    return (
      <svg {...common}>
        <path d="M12 3v12" />
        <path d="M12 3l7 3-7 3" />
        <path d="M6 21h12" />
        <path d="M8 21c0-3 1.8-5 4-5s4 2 4 5" />
      </svg>
    );
  }

  if (name === "Marketplace") {
    return (
      <svg {...common}>
        <path d="M6 7l1-3h10l1 3" />
        <path d="M5 7h14l-1 14H6L5 7z" />
        <path d="M9 10v1a3 3 0 006 0v-1" />
      </svg>
    );
  }

  // Profil
  return (
    <svg {...common}>
      <circle cx="12" cy="8" r="3" />
      <path d="M4 21c1.5-4 14.5-4 16 0" />
    </svg>
  );
}

export default function PlayerMobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: 64,
        background: "white",
        borderTop: "1px solid var(--border)",
        zIndex: 60,
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        paddingBottom: "env(safe-area-inset-bottom)",
        // ✅ visible uniquement mobile
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {/* wrapper qui masque en desktop */}
      <style>{`
        @media (min-width: 901px) {
          nav[aria-label="Navigation principale"] { display: none !important; }
        }
      `}</style>

      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");

        const inner = (
          <div
            style={{
              height: 64,
              display: "grid",
              placeItems: "center",
              gap: 3,
              opacity: t.disabled ? 0.45 : 1,
              pointerEvents: t.disabled ? "none" : "auto",
            }}
          >
            <Icon name={t.label as any} active={active} />
            <div
              style={{
                fontSize: 11,
                fontWeight: active ? 900 : 700,
                color: active ? "var(--text)" : "var(--muted)",
              }}
            >
              {t.label}
            </div>
          </div>
        );

        if (t.disabled) return <div key={t.href}>{inner}</div>;

        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              textDecoration: "none",
              color: "inherit",
              background: active ? "rgba(0,0,0,0.04)" : "transparent",
            }}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
