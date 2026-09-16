"use client";

import CoachHeader from "@/components/coach/CoachHeader";

export default function CoachShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CoachHeader />
      <div className="manager-scroll-area coach-scroll-area">
        <main className="app-shell admin-shell manager-shell coach-shell">{children}</main>
      </div>
    </>
  );
}
