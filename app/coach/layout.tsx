import type { ReactNode } from "react";
import CoachShell from "@/components/coach/CoachShell";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import RoleGuard from "@/components/auth/RoleGuard";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="manager-page manager-page-root coach-page-root">
      <AppI18nProvider>
        <CoachShell><RoleGuard allow="coach" inline>{children}</RoleGuard></CoachShell>
      </AppI18nProvider>
    </div>
  );
}
