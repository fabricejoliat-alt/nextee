"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function AdminHomeStats() {
  const [clubCount, setClubCount] = useState<number>(0);
  const [userCount, setUserCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStats() {
    setLoading(true);
    setError(null);

    // clubs count
    const clubsRes = await supabase.from("clubs").select("id", { count: "exact", head: true });
    if (clubsRes.error) {
      setError(clubsRes.error.message);
      setLoading(false);
      return;
    }
    setClubCount(clubsRes.count ?? 0);

    // users count = profiles - superadmins
    const adminsRes = await supabase.from("app_admins").select("user_id");
    if (adminsRes.error) {
      setError(adminsRes.error.message);
      setLoading(false);
      return;
    }
    const adminIds = new Set((adminsRes.data ?? []).map((a: any) => a.user_id));

    const profRes = await supabase.from("profiles").select("id");
    if (profRes.error) {
      setError(profRes.error.message);
      setLoading(false);
      return;
    }
    const allProfiles = profRes.data ?? [];
    const nonAdminUsers = allProfiles.filter((p: any) => !adminIds.has(p.id));
    setUserCount(nonAdminUsers.length);

    setLoading(false);
  }

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Accueil Admin</h1>
        <p style={{ marginTop: 6, color: "var(--muted)" }}>
          Vue rapide de l’application.
        </p>
      </div>

      {error && (
        <div
          style={{
            border: "1px solid #ffcccc",
            background: "#fff5f5",
            padding: 10,
            borderRadius: 10,
            color: "#a00",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="card">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Clubs</div>
          <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>
            {loading ? "…" : clubCount}
          </div>
        </div>

        <div className="card">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Utilisateurs</div>
          <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>
            {loading ? "…" : userCount}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
            (hors superadmin)
          </div>
        </div>
      </div>

      <button className="btn" onClick={loadStats} style={{ width: "fit-content" }}>
        Rafraîchir
      </button>
    </div>
  );
}
