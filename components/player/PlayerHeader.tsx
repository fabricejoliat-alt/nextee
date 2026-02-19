"use client";

import Link from "next/link";
import { useState } from "react";
import PlayerDesktopDrawer from "@/components/player/PlayerDesktopDrawer";
import { Bell } from "lucide-react";

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
        <div className="app-header-inner">
          <div className="app-header-grid">
            <div className="header-left">
              <Link href="/player" className="brand" aria-label="NexTee - Accueil">
                <span className="brand-nex">Nex</span>
                <span className="brand-tee">Tee</span>
              </Link>
            </div>

            <div className="header-center" />

            <div className="header-right">
              <button className="icon-btn" type="button" aria-label="Notifications (bientôt)">
                <Bell size={22} strokeWidth={2} aria-hidden="true" />
              </button>

              <div className="desktop-only">
                <button className="icon-btn" type="button" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}>
                  <BurgerIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <PlayerDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
