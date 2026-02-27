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

  const canCreate = useMemo(() => cFirst.trim() && cLast.trim(), [cFirst, cLast]);

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<UserRow>>({});
  const [authPassword, setAuthPassword] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function loadUsers() {
    setLoading(true);
    setError(null);

    const token = await getToken();
    if (!token) {
      setError("Pas de session. Reconnecte-toi.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/users/list", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Erreur chargement users");
      setUsers([]);
      setLoading(false);
      return;
    }

    setUsers((json.users ?? []) as UserRow[]);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedCreds(null);

    const token = await getToken();
    if (!token) {
      setError("Pas de session. Reconnecte-toi.");
      return;
    }

    const res = await fetch("/api/admin/create-user", {
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

    const json = await res.json();
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

    await loadUsers();
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

    const token = await getToken();
    if (!token) {
      setError("Pas de session. Reconnecte-toi.");
      setSavingId(null);
      return;
    }

    const payload = {
      userId: editingId,
      first_name: (form.first_name ?? "").toString().trim() || null,
      last_name: (form.last_name ?? "").toString().trim() || null,
      username: (form.username ?? "").toString().trim().toLowerCase() || null,
      role: (form.role ?? "player").toString().trim().toLowerCase(),
      auth_password: authPassword || null,
    };

    const res = await fetch("/api/admin/users/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Erreur sauvegarde");
      setSavingId(null);
      return;
    }

    setSavingId(null);
    cancelEdit();
    await loadUsers();
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

          <button className="btn" disabled={!canCreate} type="submit">
            Créer
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
