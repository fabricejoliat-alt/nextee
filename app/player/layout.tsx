import type { ReactNode } from "react";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import RoleGuard from "@/components/auth/RoleGuard";
import PlayerLayoutShell from "@/components/player/PlayerLayoutShell";

export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="manager-page manager-page-root player-page-root">
      <AppI18nProvider>
        <PlayerLayoutShell>
          <RoleGuard allow={["player", "parent"]} inline quiet>
            {children}
          </RoleGuard>
        </PlayerLayoutShell>
      </AppI18nProvider>
    </div>
  );
}
