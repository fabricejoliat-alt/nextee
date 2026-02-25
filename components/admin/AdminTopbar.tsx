"use client";

import AdminMobileMenu from "./AdminMobileMenu";

export default function AdminTopbar() {
  return (
    <header className="topbar">
      <div className="topbarInner">
        <div className="topTitle">
          <h2>Espace Admin</h2>
          <p>Gestion des organisations</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AdminMobileMenu />
        </div>
      </div>
    </header>
  );
}
