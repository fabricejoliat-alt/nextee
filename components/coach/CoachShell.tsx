"use client";

import { usePathname, useSearchParams } from "next/navigation";
import CoachHeader from "@/components/coach/CoachHeader";

export default function CoachShell({ children }: { children: React.ReactNode }) {
  const pathname=usePathname(),params=useSearchParams();
  return (
    <>
      <CoachHeader />
      <div className="manager-scroll-area coach-scroll-area">
        <main className="app-shell admin-shell manager-shell coach-shell"><div key={`${pathname}:${params.get("organization_id")??"all"}`}>{children}</div></main>
      </div>
    </>
  );
}
