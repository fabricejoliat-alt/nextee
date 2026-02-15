"use client";

import Link from "next/link";
import { useState } from "react";
import PlayerDesktopDrawer from "@/components/player/PlayerDesktopDrawer";

export default function PlayerHeader() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner app-header-grid">
          {/* LEFT */}
          <div className="header-left">
            <Link href="/player" className="brand" aria-label="NexTee - Accueil">
              <span className="brand-nex">Nex</span>
              <span className="brand-tee">Tee</span>
            </Link>
          </div>

          {/* CENTER */}
          <div className="header-center" />

          {/* RIGHT (desktop burger) */}
          <div className="header-right desktop-only">
            <button
              className="btn"
              type="button"
              aria-label="Ouvrir le menu"
              onClick={() => setOpen(true)}
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      <PlayerDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
