import type { ReactNode } from "react";
import ManagerShell from "@/components/manager/ManagerShell";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import RoleGuard from "@/components/auth/RoleGuard";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AppI18nProvider>
      <RoleGuard allow="manager">
        <ManagerShell>{children}</ManagerShell>
      </RoleGuard>
    </AppI18nProvider>
  );
}
