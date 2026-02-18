"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
  const scroller = (document.scrollingElement || document.documentElement) as HTMLElement;

  const getY = () => scroller.scrollTop || window.pageYOffset || window.scrollY || 0;

  const onScroll = () => {
    const y = getY();
    setScrolled(y > 6);
  };

  // init
  onScroll();

  window.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("scroll", onScroll, { passive: true });

  return () => {
    window.removeEventListener("scroll", onScroll);
    scroller.removeEventListener("scroll", onScroll);
  };
}, []);



  return (
    <>
      <header className={`app-header ${scrolled ? "scrolled" : ""} ${hidden ? "hidden" : ""}`}>
        <div className="app-header-inner app-header-grid">
          <div className="header-left">
            <Link href="/player" className="brand" aria-label="NexTee - Accueil">
              <span className="brand-nex">Nex</span>
              <span className="brand-tee">Tee</span>
            </Link>
          </div>

          <div className="header-center" />

          <div className="header-right">
            {/* Bell */}
            <button className="icon-btn" type="button" aria-label="Notifications (bientôt)">
              <Bell size={22} strokeWidth={2} aria-hidden="true" />
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
