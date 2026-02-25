import type { ReactNode } from "react";
import CoachShell from "@/components/coach/CoachShell";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AppI18nProvider>
      <CoachShell>{children}</CoachShell>
    </AppI18nProvider>
  );
}
