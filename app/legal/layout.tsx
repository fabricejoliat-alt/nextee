import type { ReactNode } from "react";
import AppI18nProvider from "@/components/i18n/AppI18nProvider";
import PublicPageShell from "@/components/public/PublicPageShell";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <AppI18nProvider><PublicPageShell>{children}</PublicPageShell></AppI18nProvider>;
}
