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

  // sentinel invisible (ne casse pas le layout)
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // hide/show (optionnel) basé sur le scroll (on garde simple)
  const lastY = useRef(0);

  useEffect(() => {
    // ✅ Scrolled via IntersectionObserver (ultra fiable)
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        // Si le sentinel n'est plus visible => on a scroll
        setScrolled(!entry.isIntersecting);
      },
      {
        root: null,
        // déclenche après ~8px (tu peux ajuster)
        rootMargin: "-8px 0px 0px 0px",
        threshold: 0,
      }
    );

    obs.observe(sentinel);

    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    // ✅ Hidden basé sur le scroll (fallback simple)
    const scroller = (document.scrollingElement || document.documentElement) as HTMLElement;

    const getY = () => scroller.scrollTop || window.scrollY || 0;

    lastY.current = getY();

    const onScroll = () => {
      const y = getY();
      const goingDown = y > lastY.current;
      const delta = Math.abs(y - lastY.current);

      if (delta > 8) {
        setHidden(goingDown && y > 80);
        lastY.current = y;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      {/* ✅ sentinel tout en haut de la page */}
      <div
        ref={sentinelRef}
        style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, pointerEvents: "none" }}
        aria-hidden="true"
      />

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
      </header>

      <PlayerDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
