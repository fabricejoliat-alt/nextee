import type { ReactNode } from "react";
import ManagerShell from "@/components/manager/ManagerShell";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import RoleGuard from "@/components/auth/RoleGuard";
import BiometricLockInvitation from "@/components/auth/BiometricLockInvitation";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="manager-page manager-page-root">
      <AppI18nProvider>
        <RoleGuard allow="manager">
          <BiometricLockInvitation />
          <ManagerShell>{children}</ManagerShell>
        </RoleGuard>
      </AppI18nProvider>
    </div>
  );
}
