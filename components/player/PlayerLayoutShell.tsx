"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerMobileNav from "@/components/player/PlayerMobileNav";
import PlayerConsentGate from "@/components/player/PlayerConsentGate";

export default function PlayerLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isConsentPage = pathname === "/player/consent-required";

  return (
    <>
      {!isConsentPage ? <PlayerHeader /> : null}
      <PlayerConsentGate />
      <main className={`app-shell player-shell${isConsentPage ? " player-shell--consent" : ""}`}>{children}</main>
      {!isConsentPage ? <PlayerMobileNav /> : null}

      <style>{`
        .player-shell { padding-bottom: 0; }
        .player-shell--consent {
          min-height: 100vh;
          padding-top: 0;
          padding-bottom: 0;
          display: grid;
          place-items: center;
        }
        @media (max-width: 900px) {
          .player-shell { padding-bottom: 84px; }
          .player-shell--consent { padding-bottom: 0; }
        }
      `}</style>
    </>
  );
}
