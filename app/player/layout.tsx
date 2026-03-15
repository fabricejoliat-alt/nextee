import type { ReactNode } from "react";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import RoleGuard from "@/components/auth/RoleGuard";
import PlayerLayoutShell from "@/components/player/PlayerLayoutShell";

export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <AppI18nProvider>
      <RoleGuard allow={["player", "parent"]}>
        <PlayerLayoutShell>{children}</PlayerLayoutShell>
      </RoleGuard>
    </AppI18nProvider>
  );
}
