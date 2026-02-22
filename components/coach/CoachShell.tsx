"use client";

import CoachHeader from "@/components/coach/CoachHeader";

export default function CoachShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CoachHeader />
      <main className="app-shell">{children}</main>
      {/* ✅ pas de footer */}
    </>
  );
}