import type { ReactNode } from "react";
import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerMobileNav from "@/components/player/PlayerMobileNav";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import RoleGuard from "@/components/auth/RoleGuard";

export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <AppI18nProvider>
      <RoleGuard allow={["player", "parent"]}>
        <PlayerHeader />
        <main className="app-shell player-shell">
          {children}
        </main>
        <PlayerMobileNav />
      </RoleGuard>

      <style>{`
        .player-shell { padding-bottom: 0; }
        @media (max-width: 900px) {
          .player-shell { padding-bottom: 84px; }
        }
      `}</style>
    </AppI18nProvider>
  );
}
