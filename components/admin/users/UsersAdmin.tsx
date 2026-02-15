"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type UserRow = {
  id: string; // interne seulement (pas affiché)
  email: string;
  first_name: string | null;
  last_name: string | null;

  birth_date: string | null; // YYYY-MM-DD
  nationality: string | null;
  sex: string | null;
  handicap: number | null;

  address: string | null;
  postal_code: string | null;
  locality: string | null;

  phone: string | null;
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

  // create user (simple)
  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [createdTempPassword, setCreatedTempPassword] = useState<string | null>(null);

  const canCreate = useMemo(() => {
    return cFirst.trim() && cLast.trim() && cEmail.trim();
  }, [cFirst, cLast, cEmail]);

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<UserRow>>({});
  const [authPassword, setAuthPassword] = useState(""); // mot de passe Auth (optionnel)

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

    setUsers(json.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedTempPassword(null);

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
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Erreur création utilisateur");
      return;
    }

    setCreatedTempPassword(json.tempPassword ?? null);
    setCFirst("");
    setCLast("");
    setCEmail("");

    await loadUsers();
  }

  function startEdit(u: UserRow) {
    setEditingId(u.id);
    setAuthPassword("");
    setForm({
      id: u.id,
      email: u.email,
      first_name: u.first_name ?? "",
      last_name: u.last_name ?? "",
      birth_date: u.birth_date,
      nationality: u.nationality ?? "",
      sex: u.sex ?? "",
      handicap: u.handicap ?? null,
      address: u.address ?? "",
      postal_code: u.postal_code ?? "",
      locality: u.locality ?? "",
      phone: u.phone ?? "",
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

    let handicap: number | null = null;

if (form.handicap !== null && form.handicap !== undefined) {
  const parsed = Number(form.handicap);
  if (!Number.isNaN(parsed)) {
    handicap = parsed;
  }
}


    const payload = {
      userId: editingId,

      first_name: (form.first_name ?? "").toString().trim() || null,
      last_name: (form.last_name ?? "").toString().trim() || null,

      birth_date: form.birth_date ? String(form.birth_date) : null,
      nationality: (form.nationality ?? "").toString().trim() || null,
      sex: (form.sex ?? "").toString().trim() || null,
      handicap: Number.isFinite(handicap as any) ? handicap : null,

      address: (form.address ?? "").toString().trim() || null,
      postal_code: (form.postal_code ?? "").toString().trim() || null,
      locality: (form.locality ?? "").toString().trim() || null,
      phone: (form.phone ?? "").toString().trim() || null,

      // Auth updates (optionnels)
      email: (form.email ?? "").toString().trim().toLowerCase() || null,
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
        <p style={{ marginTop: 6, color: "var(--muted)" }}>
          Le superadmin n’apparaît pas ici. Pas d’UUID affiché.
        </p>
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

      {/* Create */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Créer un utilisateur</h2>

        <form onSubmit={createUser} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <input placeholder="Prénom" value={cFirst} onChange={(e) => setCFirst(e.target.value)} style={inputStyle} />
          <input placeholder="Nom" value={cLast} onChange={(e) => setCLast(e.target.value)} style={inputStyle} />
          <input placeholder="Email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} style={inputStyle} />

          <button className="btn" disabled={!canCreate} type="submit">
            Créer
          </button>
        </form>

        {createdTempPassword && (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
            <div style={{ fontWeight: 900 }}>Mot de passe temporaire (Auth)</div>
            <div style={{ fontFamily: "monospace", marginTop: 6 }}>{createdTempPassword}</div>
          </div>
        )}
      </div>

      {/* List */}
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
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>{u.email}</div>
                      </div>

                      <button className="btn" onClick={() => startEdit(u)}>
                        Éditer
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                          <input
                            placeholder="Prénom"
                            value={(form.first_name ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                            style={inputStyle}
                          />
                          <input
                            placeholder="Nom"
                            value={(form.last_name ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                            style={inputStyle}
                          />
                        </div>

                        <input
                          placeholder="Adresse e-mail (login)"
                          value={(form.email ?? "") as any}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                          style={inputStyle}
                        />

                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
                          <input
                            type="date"
                            value={(form.birth_date ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value || null }))}
                            style={inputStyle}
                          />

                          <input
                            placeholder="Nationalité"
                            value={(form.nationality ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}
                            style={inputStyle}
                          />

                          <select
                            value={(form.sex ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}
                            style={inputStyle}
                          >
                            <option value="">Sexe…</option>
                            <option value="M">M</option>
                            <option value="F">F</option>
                            <option value="X">X</option>
                          </select>
                        </div>

                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                          <input
  type="number"
  step="0.1"
  placeholder="Handicap"
  value={form.handicap ?? ""}
  onChange={(e) =>
    setForm((f) => ({
      ...f,
      handicap: e.target.value === "" ? null : Number(e.target.value),
    }))
  }
  style={inputStyle}
/>


                          <input
                            placeholder="Téléphone"
                            value={(form.phone ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                            style={inputStyle}
                          />
                        </div>

                        <input
                          placeholder="Adresse"
                          value={(form.address ?? "") as any}
                          onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                          style={inputStyle}
                        />

                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 2fr" }}>
                          <input
                            placeholder="Code postal"
                            value={(form.postal_code ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                            style={inputStyle}
                          />
                          <input
                            placeholder="Localité"
                            value={(form.locality ?? "") as any}
                            onChange={(e) => setForm((f) => ({ ...f, locality: e.target.value }))}
                            style={inputStyle}
                          />
                        </div>

                        <input
                          placeholder="Changer mot de passe (login) (optionnel)"
                          type="text"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          style={inputStyle}
                        />
                      </div>

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
