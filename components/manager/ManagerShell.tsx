"use client";

import { useSearchParams } from "next/navigation";
import ManagerHeader from "@/components/manager/ManagerHeader";

export default function ManagerShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  return (
    <>
      <ManagerHeader />
      <div className="manager-scroll-area">
        <main className="app-shell admin-shell manager-shell"><div key={params.get("organization_id") ?? "all"}>{children}</div></main>
      </div>
    </>
  );
}
