"use client";

import Link from "next/link";
import { useState } from "react";
import PlayerDesktopDrawer from "@/components/player/PlayerDesktopDrawer";

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 22a2.4 2.4 0 0 0 2.35-2h-4.7A2.4 2.4 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z"
        opacity="0.95"
      />
    </svg>
  );
}

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

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner app-header-grid">
          <div className="header-left">
            <Link href="/player" className="brand" aria-label="NexTee - Accueil">
              <span className="brand-nex">Nex</span>
              <span className="brand-tee">Tee</span>
            </Link>
          </div>

          <div className="header-center" />

          <div className="header-right">
            {/* Bell (always visible) */}
            <button className="icon-btn" type="button" aria-label="Notifications (bientôt)">
              <BellIcon />
            </button>

            {/* Burger (desktop only) */}
            <div className="desktop-only">
              <button
                className="icon-btn"
                type="button"
                aria-label="Ouvrir le menu"
                onClick={() => setOpen(true)}
              >
                <BurgerIcon />
              </button>
            </div>
          </div>
        </div>
      </header>

      <PlayerDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
