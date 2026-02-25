import type { ReactNode } from "react";
import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerMobileNav from "@/components/player/PlayerMobileNav";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";

export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <AppI18nProvider>
      <PlayerHeader />
      <main className="app-shell player-shell">
        {children}
      </main>
      <PlayerMobileNav />

      <style>{`
        .player-shell { padding-bottom: 0; }
        @media (max-width: 900px) {
          .player-shell { padding-bottom: 84px; }
        }
      `}</style>
    </AppI18nProvider>
  );
}
