"use client";

import PlayerMobileMenu from "@/components/player/PlayerMobileMenu";

export default function PlayerShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "white",
        color: "var(--text)",
      }}
    >
      {/* Topbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "white",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 900 }}>Espace Joueur</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PlayerMobileMenu />
          </div>
        </div>
      </div>

      {/* Content */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {children}
      </main>
    </div>
  );
}
