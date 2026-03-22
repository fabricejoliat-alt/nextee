"use client";

import { useEffect, useMemo, useState } from "react";

type ImpersonationUser = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  email: string | null;
  roles: string[];
  club_count: number;
};

function isLocalDevBrowser() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export default function DevImpersonatePage() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | "manager" | "coach" | "player" | "parent">("all");
  const [users, setUsers] = useState<ImpersonationUser[]>([]);

  useEffect(() => {
    setEnabled(isLocalDevBrowser());
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (role !== "all") params.set("role", role);
        const res = await fetch(`/api/dev/impersonate/users?${params.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Could not load users."));
        if (!cancelled) setUsers(Array.isArray(json?.users) ? (json.users as ImpersonationUser[]) : []);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Could not load users.");
          setUsers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const timer = window.setTimeout(load, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, query, role]);

  const countLabel = useMemo(() => `${users.length} utilisateur(s)`, [users.length]);

  async function impersonate(userId: string) {
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch("/api/dev/impersonate/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Could not generate dev sign-in link."));
      if (!json?.token_hash || !json?.email || !json?.verification_type) throw new Error("No dev impersonation token returned.");
      const params = new URLSearchParams({
        token_hash: String(json.token_hash),
        email: String(json.email),
        type: String(json.verification_type),
      });
      window.location.assign(`/dev/impersonate/complete?${params.toString()}`);
    } catch (e: any) {
      setError(e?.message ?? "Could not sign in.");
      setBusyUserId(null);
    }
  }

  return (
    <div className="auth-bg">
      <div
        className="auth-shell"
        style={{
          width: "min(1380px, calc(100vw - 24px))",
          maxWidth: 1380,
        }}
      >
        <div className="auth-card" style={{ width: "100%", maxWidth: "none" }}>
          <div className="auth-brand-wrapper">
            <div className="auth-brand auth-brand--dark">
              <span className="auth-brand-nex">Activi</span>
              <span className="auth-brand-tee">Tee</span>
            </div>
            <div className="auth-tagline">Impersonation locale de développement</div>
          </div>

          {!enabled ? (
            <div className="auth-form">
              <div className="auth-error">Disponible uniquement sur `localhost` en environnement de développement.</div>
            </div>
          ) : (
            <div className="auth-form" style={{ display: "grid", gap: 14, minWidth: 0 }}>
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "minmax(320px,1fr) 200px auto",
                  alignItems: "end",
                  minWidth: 0,
                }}
              >
                <label className="field auth-field">
                  <span>Recherche</span>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, username, e-mail..." />
                </label>

                <label className="field auth-field">
                  <span>Rôle</span>
                  <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="all">Tous</option>
                    <option value="manager">Manager</option>
                    <option value="coach">Coach</option>
                    <option value="player">Joueur</option>
                    <option value="parent">Parent</option>
                  </select>
                </label>

                <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 700 }}>{countLabel}</div>
              </div>

              {error ? <div className="auth-error">{error}</div> : null}

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 14,
                  overflow: "hidden",
                  background: "#fff",
                  minWidth: 0,
                }}
              >
                <div>
                  <div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(320px,1.4fr) minmax(220px,1fr) minmax(120px,0.5fr) 220px",
                        gap: 12,
                        padding: "12px 14px",
                        fontSize: 12,
                        fontWeight: 900,
                        color: "#475569",
                        borderBottom: "1px solid #e5e7eb",
                        background: "#f8fafc",
                      }}
                    >
                      <div>Utilisateur</div>
                      <div>Accès</div>
                      <div>Clubs</div>
                      <div />
                    </div>

                    <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
                      {loading ? (
                        <div style={{ padding: 16, color: "#6b7280", fontWeight: 700 }}>Chargement...</div>
                      ) : users.length === 0 ? (
                        <div style={{ padding: 16, color: "#6b7280", fontWeight: 700 }}>Aucun utilisateur trouvé.</div>
                      ) : (
                        users.map((user) => (
                          <div
                            key={user.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(320px,1.4fr) minmax(220px,1fr) minmax(120px,0.5fr) 220px",
                              gap: 12,
                              padding: "12px 14px",
                              borderBottom: "1px solid #f1f5f9",
                              alignItems: "center",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 900, color: "#111827" }}>{user.name}</div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#64748b",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {user.username || user.email || user.id}
                              </div>
                            </div>
                            <div style={{ fontSize: 12, color: "#334155", fontWeight: 700 }}>{user.roles.join(" • ") || "—"}</div>
                            <div style={{ fontSize: 12, color: "#334155", fontWeight: 700 }}>{user.club_count}</div>
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button
                                className="cta-green auth-submit"
                                type="button"
                                style={{ width: "100%", maxWidth: 220 }}
                                disabled={busyUserId === user.id}
                                onClick={() => void impersonate(user.id)}
                              >
                                {busyUserId === user.id ? "Connexion..." : "Se connecter en tant que"}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="auth-footnote">
                Dev only. Utilise un lien magique généré côté serveur, sans modifier le vrai mot de passe du compte.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
