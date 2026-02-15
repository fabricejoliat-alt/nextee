"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import AdminMobileMenu from "./AdminMobileMenu";

export default function AdminTopbar() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function getUser() {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
    }

    getUser();
  }, []);

  return (
    <header className="topbar">
      <div className="topbarInner">
        <div className="topTitle">
          <h2>Espace Admin</h2>
          <p>Gestion des clubs</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {userId && (
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              UUID: {userId}
            </div>
          )}

          <AdminMobileMenu />
        </div>
      </div>
    </header>
  );
}
