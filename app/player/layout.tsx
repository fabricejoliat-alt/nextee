import type { ReactNode } from "react";
import PlayerHeader from "@/components/player/PlayerHeader";
import PlayerMobileNav from "@/components/player/PlayerMobileNav";

export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlayerHeader />
      <main className="app-shell">{children}</main>
      <PlayerMobileNav />
    </>
  );
}
