"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell } from "lucide-react";
import CoachDesktopDrawer from "@/components/coach/CoachDesktopDrawer";

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

export default function CoachHeader() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-grid app-header-grid--centered">
            <div className="header-left header-left--icon">
              <button className="icon-btn" type="button" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}>
                <BurgerIcon />
              </button>
            </div>

            <div className="header-center header-center--brand">
              <Link href="/coach" className="brand" aria-label="NexTee - Coach">
                <span className="brand-nex">Nex</span>
                <span className="brand-tee">Tee</span>
              </Link>
            </div>

            <div className="header-right header-right--icon">
              <button className="icon-btn" type="button" aria-label="Notifications (bientôt)">
                <Bell size={22} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <CoachDesktopDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}