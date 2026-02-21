"use client";

import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerMobileNav from "@/components/player/PlayerMobileNav";

export default function PlayerShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlayerHeader />
      <main className="app-shell">{children}</main>
      <PlayerMobileNav />
    </>
  );
}