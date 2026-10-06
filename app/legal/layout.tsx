import type { ReactNode } from "react";
import PublicPageShell from "@/components/public/PublicPageShell";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <PublicPageShell>{children}</PublicPageShell>;
}
