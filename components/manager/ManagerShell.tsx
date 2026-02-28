"use client";

import ManagerHeader from "@/components/manager/ManagerHeader";

export default function ManagerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="manager-page">
      <ManagerHeader />
      <main className="app-shell admin-shell manager-shell">{children}</main>
    </div>
  );
}
