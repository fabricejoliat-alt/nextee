import type { ReactNode } from "react";
import CoachShell from "@/components/coach/CoachShell";

export default function Layout({ children }: { children: ReactNode }) {
  return <CoachShell>{children}</CoachShell>;
}