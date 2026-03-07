"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AppRole = "manager" | "coach" | "player" | "parent" | "captain" | "staff";

type UserRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  role: AppRole | null;
  is_performance: boolean | null;
};

function labelName(u: UserRow) {
  const n = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return n || "Utilisateur";
}

export default function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // create user
  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cRole, setCRole] = useState<AppRole>("player");
  const [createdCreds, setCreatedCreds] = useState<{ username: string; tempPassword: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const canCreate = useMemo(() => cFirst.trim() && cLast.trim(), [cFirst, cLast]);

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<UserRow>>({});
  const [authPassword, setAuthPassword] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Pas de session. Reconnecte-toi.");
        setUsers([]);
        return;
      }

      const res = await fetchWithTimeout("/api/admin/users/list", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Erreur chargement users");
        setUsers([]);
        return;
      }

      setUsers((json.users ?? []) as UserRow[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur chargement users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setError(null);
    setCreatedCreds(null);
    setCreating(true);

    try {
      const token = await getToken();
      if (!token) {
        setError("Pas de session. Reconnecte-toi.");
        return;
      }

      const res = await fetchWithTimeout("/api/admin/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          first_name: cFirst.trim(),
          last_name: cLast.trim(),
          email: cEmail.trim().toLowerCase(),
          role: cRole,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Erreur création utilisateur");
        return;
      }

      setCreatedCreds({
        username: json.username ?? "",
        tempPassword: json.tempPassword ?? "",
      });
      setCFirst("");
      setCLast("");
      setCEmail("");
      setCRole("player");
      // Refresh list in background; do not block button spinner on slow network.
      void loadUsers();
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("Délai dépassé. Vérifie ta connexion puis réessaie.");
      } else {
        setError(e instanceof Error ? e.message : "Erreur création utilisateur");
      }
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u: UserRow) {
    setEditingId(u.id);
    setAuthPassword("");
    setForm({
      id: u.id,
      email: u.email ?? "",
      first_name: u.first_name ?? "",
      last_name: u.last_name ?? "",
      username: u.username ?? "",
      role: (u.role ?? "player") as AppRole,
      is_performance: u.is_performance ?? false,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setAuthPassword("");
    setForm({});
  }

  async function saveEdit() {
    if (!editingId) return;

    setSavingId(editingId);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Pas de session. Reconnecte-toi.");
        return;
      }

      const payload = {
        userId: editingId,
        first_name: (form.first_name ?? "").toString().trim() || null,
        last_name: (form.last_name ?? "").toString().trim() || null,
        username: (form.username ?? "").toString().trim().toLowerCase() || null,
        role: (form.role ?? "player").toString().trim().toLowerCase(),
        is_performance: (form.role ?? "player") === "player" ? Boolean(form.is_performance) : null,
        auth_password: authPassword || null,
      };

      const res = await fetchWithTimeout("/api/admin/users/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Erreur sauvegarde");
        return;
      }

      cancelEdit();
      // Refresh list in background; keep edit spinner deterministic.
      void loadUsers();
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("Délai dépassé. Vérifie ta connexion puis réessaie.");
      } else {
        setError(e instanceof Error ? e.message : "Erreur sauvegarde");
      }
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Utilisateurs</h1>
      </div>

      {error && (
        <div
          style={{
            border: "1px solid #ffcccc",
            background: "#fff5f5",
            padding: 12,
            borderRadius: 12,
            color: "#a00",
          }}
        >
          {error}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Créer un utilisateur</h2>

        <form onSubmit={createUser} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <input placeholder="Prénom" value={cFirst} onChange={(e) => setCFirst(e.target.value)} style={inputStyle} />
          <input placeholder="Nom" value={cLast} onChange={(e) => setCLast(e.target.value)} style={inputStyle} />
          <input placeholder="Adresse e-mail (optionnel)" value={cEmail} onChange={(e) => setCEmail(e.target.value)} style={inputStyle} />
          <select value={cRole} onChange={(e) => setCRole(e.target.value as AppRole)} style={inputStyle}>
            <option value="player">Joueur</option>
            <option value="coach">Coach</option>
            <option value="manager">Manager</option>
            <option value="parent">Parent</option>
            <option value="captain">Capitaine</option>
            <option value="staff">Staff</option>
          </select>

          <button className="btn" disabled={!canCreate || creating} type="submit">
            {creating ? "Création…" : "Créer"}
          </button>
        </form>

        {createdCreds && (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
            <div style={{ fontWeight: 900 }}>Identifiants générés</div>
            <div style={{ marginTop: 6 }}>Username: <b>{createdCreds.username}</b></div>
            <div style={{ marginTop: 6 }}>
              Mot de passe: <span style={{ fontFamily: "monospace" }}>{createdCreds.tempPassword}</span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Liste</h2>

        {loading ? (
          <div>Chargement…</div>
        ) : users.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Aucun utilisateur.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {users.map((u) => {
              const isEditing = editingId === u.id;

              return (
                <div
                  key={u.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  {!isEditing ? (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{labelName(u)}</div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>{u.email ?? "—"}</div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          username: {u.username ?? "—"} • rôle: {u.role ?? "player"}
                        </div>
                        {(u.role ?? "player") === "player" && (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            mode performance: {u.is_performance ? "oui" : "non"}
                          </div>
                        )}
                      </div>

                      <button className="btn" onClick={() => startEdit(u)}>
                        Éditer
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                        <input
                          placeholder="Prénom"
                          value={(form.first_name ?? "") as string}
                          onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                          style={inputStyle}
                        />
                        <input
                          placeholder="Nom"
                          value={(form.last_name ?? "") as string}
                          onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                          style={inputStyle}
                        />
                      </div>

                      <input
                        placeholder="Username"
                        value={(form.username ?? "") as string}
                        onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                        style={inputStyle}
                      />

                      <select
                        value={(form.role ?? "player") as string}
                        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AppRole }))}
                        style={inputStyle}
                      >
                        <option value="player">Joueur</option>
                        <option value="coach">Coach</option>
                        <option value="manager">Manager</option>
                        <option value="parent">Parent</option>
                        <option value="captain">Capitaine</option>
                        <option value="staff">Staff</option>
                      </select>

                      {(form.role ?? "player") === "player" && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(form.is_performance)}
                            onChange={(e) => setForm((f) => ({ ...f, is_performance: e.target.checked }))}
                          />
                          Mode performance
                        </label>
                      )}

                      <input
                        placeholder="Changer mot de passe (optionnel)"
                        type="text"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        style={inputStyle}
                      />

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn" onClick={saveEdit} disabled={savingId === u.id}>
                          {savingId === u.id ? "Sauvegarde…" : "Sauvegarder"}
                        </button>
                        <button className="btn" onClick={cancelEdit} disabled={savingId === u.id}>
                          Annuler
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};
