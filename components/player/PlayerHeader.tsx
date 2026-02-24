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
          <div className="app-header-grid app-header-grid--centered">
            {/* LEFT: Burger */}
            <div className="header-left header-left--icon">
              <button
                className="icon-btn"
                type="button"
                aria-label="Ouvrir le menu"
                onClick={() => setOpen(true)}
              >
                <BurgerIcon />
              </button>
            </div>

            {/* CENTER: Logo */}
            <div className="header-center header-center--brand">
              <Link href="/player" className="brand" aria-label="ActiviTee - Accueil">
                <span className="brand-nex">Activi</span>
                <span className="brand-tee">Tee</span>
              </Link>
            </div>

            {/* RIGHT: Bell */}
            <div className="header-right header-right--icon">
              <button className="icon-btn" type="button" aria-label="Notifications (bientôt)">
                <Bell size={22} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Drawer (désormais utilisable aussi en mobile/app via CSS) */}
      <PlayerDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}