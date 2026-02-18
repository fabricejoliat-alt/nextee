"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Props = {
  open: boolean;
  onClose: () => void;
};

function isActive(pathname: string, href: string) {
  if (href === "/player") return pathname === "/player";
  return pathname.startsWith(href);
}

export default function PlayerDesktopDrawer({ open, onClose }: Props) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const items = [
    { href: "/player", label: "Accueil", enabled: true },
    { href: "/player/calendar", label: "Calendrier", enabled: false },
    { href: "/player/golf", label: "Mon Golf", enabled: true },
    { href: "/player/marketplace", label: "Marketplace", enabled: true },
    { href: "/player/profile", label: "Mon profil", enabled: true },
  ] as const;

  return (
    <>
      <button
        type="button"
        className="drawer-overlay"
        aria-label="Fermer le menu"
        onClick={onClose}
      />

      <aside className="drawer-panel" aria-label="Menu principal">
        <div className="drawer-head">
          <div className="drawer-title">Menu</div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <nav className="drawer-nav">
          {items.map((it) => {
            const active = isActive(pathname, it.href);

            if (!it.enabled) {
              return (
                <button
                  key={it.href}
                  type="button"
                  className={`drawer-link ${active ? "active" : ""}`}
                  disabled
                  aria-disabled="true"
                  title="Bientôt disponible"
                >
                  {it.label}
                  <span className="drawer-soon">Bientôt</span>
                </button>
              );
            }

            return (
              <Link
                key={it.href}
                href={it.href}
                className={`drawer-link ${active ? "active" : ""}`}
                onClick={onClose}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
