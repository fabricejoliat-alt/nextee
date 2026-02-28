import type { ReactNode } from "react";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import RoleGuard from "@/components/auth/RoleGuard";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AppI18nProvider>
      <RoleGuard allow="parent">{children}</RoleGuard>
    </AppI18nProvider>
  );
}

