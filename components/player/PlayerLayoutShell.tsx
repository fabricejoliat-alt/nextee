"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerMobileNav from "@/components/player/PlayerMobileNav";
import PlayerConnectivityStatus from "@/components/player/PlayerConnectivityStatus";

export default function PlayerLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPlayerHome = pathname === "/player";

  return (
    <>
      <PlayerHeader />
      <PlayerConnectivityStatus />
      <div className={`player-scroll-area${isPlayerHome ? " player-scroll-area--home" : ""}`} data-scroll-container>
        <main className="app-shell player-shell">{children}</main>
      </div>
      <PlayerMobileNav />

      <style>{`
        .player-shell { padding-bottom: 0; }
        @media (max-width: 900px) {
          .player-shell { padding-bottom: 84px; }
        }
      `}</style>
    </>
  );
}
