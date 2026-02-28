"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Child = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  handicap: number | null;
  avatar_url: string | null;
  birth_date: string | null;
  relation: string | null;
  is_primary: boolean;
  clubs: Array<{ id: string; name: string }>;
};

function fullName(child: Child) {
  const n = `${child.first_name ?? ""} ${child.last_name ?? ""}`.trim();
  return n || "Joueur";
}

export default function ParentHomePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedId, setSelectedId] = useState("");

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadChildren() {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/parent/children", {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Erreur de chargement");

      const list = (json?.children ?? []) as Child[];
      setChildren(list);

      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem("parent:selected_child_id") : null;
      const selected =
        (stored && list.some((c) => c.id === stored) && stored) ||
        list.find((c) => c.is_primary)?.id ||
        list[0]?.id ||
        "";
      setSelectedId(selected);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement");
      setChildren([]);
      setSelectedId("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChildren();
  }, []);

  useEffect(() => {
    if (!selectedId || typeof window === "undefined") return;
    window.localStorage.setItem("parent:selected_child_id", selectedId);
  }, [selectedId]);

  const selectedChild = useMemo(
    () => children.find((c) => c.id === selectedId) ?? null,
    [children, selectedId]
  );

  return (
    <main className="admin-page" style={{ minHeight: "100dvh", padding: 20 }}>
      <div className="admin-shell" style={{ display: "grid", gap: 14 }}>
        <div className="card">
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Espace parent</h1>
          <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
            Sélectionne l’enfant à consulter. Le scénario multi-enfants est pris en charge.
          </div>
        </div>

        {error && (
          <div className="card" style={{ borderColor: "#f8b4b4", background: "#fff5f5", color: "#9b1c1c" }}>
            {error}
          </div>
        )}

        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Enfant</div>

          {loading ? (
            <div>Chargement…</div>
          ) : children.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>
              Aucun enfant rattaché. Demande au manager de créer le lien parent/enfant.
            </div>
          ) : (
            <>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={inputStyle}>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {fullName(child)}
                    {child.is_primary ? " (principal)" : ""}
                  </option>
                ))}
              </select>

              {selectedChild && (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{fullName(selectedChild)}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    username: {selectedChild.username ?? "—"}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    handicap:{" "}
                    {typeof selectedChild.handicap === "number"
                      ? selectedChild.handicap.toFixed(1)
                      : "—"}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    clubs:{" "}
                    {selectedChild.clubs.length > 0
                      ? selectedChild.clubs.map((c) => c.name).join(" • ")
                      : "—"}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};

