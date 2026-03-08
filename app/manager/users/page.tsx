"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type MemberRow = {
  id: string;
  club_id: string;
  user_id: string;
  role: "manager" | "coach" | "player" | "parent";
  is_active: boolean | null;
  is_performance: boolean | null;
  auth_email?: string | null;
  profiles?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    phone: string | null;
    birth_date: string | null;
    sex: string | null;
    handedness: string | null;
    handicap: number | null;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    avs_no: string | null;
    avatar_url: string | null;
    staff_function: string | null;
  } | null;
};

type EditForm = {
  id: string;
  user_id: string;
  role: "manager" | "coach" | "player" | "parent";
  is_active: boolean;
  is_performance: boolean;
  first_name: string;
  last_name: string;
  username: string;
  auth_email: string;
  auth_password: string;
  phone: string;
  birth_date: string;
  sex: string;
  handedness: string;
  handicap: string;
  address: string;
  postal_code: string;
  city: string;
  avs_no: string;
  staff_function: string;
};

function labelName(m: MemberRow) {
  const n = `${m.profiles?.first_name ?? ""} ${m.profiles?.last_name ?? ""}`.trim();
  return n || "Utilisateur";
}

function generatePassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function normalizeAuthEmailInput(raw?: string | null) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.endsWith("@noemail.local")) return "";
  return email;
}

export default function ManagerUsersPage() {
  const [clubId, setClubId] = useState("");
  const [clubNamesById, setClubNamesById] = useState<Record<string, string>>({});

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cStaffFunction, setCStaffFunction] = useState("");
  const [cRole, setCRole] = useState<"manager" | "coach" | "player" | "parent">("player");
  const [createdCreds, setCreatedCreds] = useState<{ username: string; tempPassword: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "manager" | "coach" | "player" | "parent">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<EditForm>>({});

  const canCreate = useMemo(() => cFirst.trim() && cLast.trim() && clubId, [cFirst, cLast, clubId]);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function resolveManagerClub() {
    const headers = await authHeader();
    const res = await fetch("/api/manager/my-clubs", { method: "GET", headers, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? "Impossible de récupérer les clubs manager");
    const list = Array.isArray(json?.clubs) ? json.clubs : [];
    if (list.length === 0) {
      throw new Error("Aucun club manager actif trouvé");
    }
    const names: Record<string, string> = {};
    for (const c of list) {
      if (c?.id) names[String(c.id)] = String(c?.name ?? "Club");
    }
    setClubNamesById(names);
    return String(list[0].id);
  }

  async function loadMembers(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${selectedClubId}/members`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Load failed");
      setMembers((json.members ?? []) as MemberRow[]);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement users");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const managerClubId = await resolveManagerClub();
        setClubId(managerClubId);
      } catch (e: any) {
        setError(e?.message ?? "Impossible de charger le club");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clubId) {
      setMembers([]);
      return;
    }
    void loadMembers(clubId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedCreds(null);
    if (!clubId) return;

    const headers = await authHeader();
    const res = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        first_name: cFirst.trim(),
        last_name: cLast.trim(),
        email: cEmail.trim().toLowerCase(),
        phone: cPhone.trim(),
        staff_function: cRole === "manager" || cRole === "coach" ? cStaffFunction.trim() : "",
        role: cRole,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Erreur création utilisateur");
      return;
    }

    setCreatedCreds({
      username: (json?.username ?? "").toString(),
      tempPassword: json?.tempPassword ?? null,
    });

    setCFirst("");
    setCLast("");
    setCEmail("");
    setCPhone("");
    setCStaffFunction("");
    setCRole("player");
    await loadMembers(clubId);
  }

  function startEdit(m: MemberRow) {
    setEditingId(m.id);
    setForm({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      is_active: m.is_active ?? true,
      is_performance: m.is_performance ?? false,
      first_name: m.profiles?.first_name ?? "",
      last_name: m.profiles?.last_name ?? "",
      username: m.profiles?.username ?? "",
      auth_email: normalizeAuthEmailInput(m.auth_email),
      auth_password: "",
      phone: m.profiles?.phone ?? "",
      birth_date: m.profiles?.birth_date ?? "",
      sex: m.profiles?.sex ?? "",
      handedness: m.profiles?.handedness ?? "",
      handicap: m.profiles?.handicap == null ? "" : String(m.profiles.handicap),
      address: m.profiles?.address ?? "",
      postal_code: m.profiles?.postal_code ?? "",
      city: m.profiles?.city ?? "",
      avs_no: m.profiles?.avs_no ?? "",
      staff_function: m.profiles?.staff_function ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({});
  }

  async function saveEdit() {
    if (!editingId || !clubId) return;

    setSavingId(editingId);
    setError(null);

    const headers = await authHeader();
    const payload: Record<string, any> = {
      memberId: editingId,
      role: form.role,
      is_active: form.is_active,
      first_name: (form.first_name ?? "").toString().trim(),
      last_name: (form.last_name ?? "").toString().trim(),
      username: (form.username ?? "").toString().trim().toLowerCase(),
      auth_email: normalizeAuthEmailInput(form.auth_email as string),
      auth_password: (form.auth_password ?? "").toString(),
    };

    if ((form.role ?? "player") === "player") {
      payload.phone = (form.phone ?? "").toString().trim();
      payload.birth_date = (form.birth_date ?? "").toString().trim();
      payload.sex = (form.sex ?? "").toString().trim();
      payload.handedness = (form.handedness ?? "").toString().trim();
      payload.handicap = (form.handicap ?? "").toString().trim();
      payload.address = (form.address ?? "").toString().trim();
      payload.postal_code = (form.postal_code ?? "").toString().trim();
      payload.city = (form.city ?? "").toString().trim();
      payload.avs_no = (form.avs_no ?? "").toString().trim();
    }
    if ((form.role ?? "player") === "parent") {
      payload.auth_email = normalizeAuthEmailInput(form.auth_email as string);
      payload.auth_password = (form.auth_password ?? "").toString();
      payload.phone = (form.phone ?? "").toString().trim();
      payload.address = (form.address ?? "").toString().trim();
      payload.postal_code = (form.postal_code ?? "").toString().trim();
      payload.city = (form.city ?? "").toString().trim();
    }
    if ((form.role ?? "player") === "manager" || (form.role ?? "player") === "coach") {
      payload.staff_function = (form.staff_function ?? "").toString().trim();
    } else {
      payload.staff_function = "";
    }

    const res = await fetch(`/api/manager/clubs/${clubId}/members`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Erreur sauvegarde");
      setSavingId(null);
      return;
    }

    if ((form.role ?? "player") === "player" && form.user_id) {
      const { error: perfError } = await supabase.rpc("set_player_performance_mode", {
        p_org_id: clubId,
        p_player_id: form.user_id,
        p_enabled: Boolean(form.is_performance),
      });
      if (perfError) {
        setError(perfError.message || "Erreur sauvegarde mode performance");
        setSavingId(null);
        return;
      }
    }

    setSavingId(null);
    cancelEdit();
    await loadMembers(clubId);
  }

  const sorted = useMemo(
    () =>
      members
        .slice()
        .sort((a, b) => labelName(a).localeCompare(labelName(b), "fr")),
    [members]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (!q) return true;
      const haystack = [
        labelName(m),
        m.profiles?.username ?? "",
        m.auth_email ?? "",
        m.role ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [search, sorted, roleFilter]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, totalItems);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, clubId, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div style={{ display: "grid", gap: 16, width: "min(980px, 100%)", margin: "0 auto", boxSizing: "border-box" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Utilisateurs</h1>
        <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
          Liste des utilisateurs rattachés au golf dont tu es manager.
        </div>
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

        <form onSubmit={createUser} style={{ display: "grid", gap: 10, maxWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input placeholder="Prénom" value={cFirst} onChange={(e) => setCFirst(e.target.value)} style={inputStyle} />
            <input placeholder="Nom" value={cLast} onChange={(e) => setCLast(e.target.value)} style={inputStyle} />
          </div>

          <input placeholder="Adresse e-mail (optionnel)" value={cEmail} onChange={(e) => setCEmail(e.target.value)} style={inputStyle} />
          <input placeholder="Téléphone (optionnel)" value={cPhone} onChange={(e) => setCPhone(e.target.value)} style={inputStyle} />
          {(cRole === "manager" || cRole === "coach") ? (
            <input
              placeholder="Fonction (optionnel)"
              value={cStaffFunction}
              onChange={(e) => setCStaffFunction(e.target.value)}
              style={inputStyle}
            />
          ) : null}

          <select value={cRole} onChange={(e) => setCRole(e.target.value as any)} style={inputStyle}>
            <option value="player">Joueur</option>
            <option value="coach">Coach</option>
            <option value="manager">Manager</option>
            <option value="parent">Parent</option>
          </select>

          <button className="btn" disabled={!canCreate} type="submit">
            Créer
          </button>
        </form>

        {createdCreds && (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
            <div style={{ fontWeight: 900 }}>Identifiants générés</div>
            <div style={{ marginTop: 6 }}>
              Username: <b>{createdCreds.username || "—"}</b>
            </div>
            <div style={{ marginTop: 6 }}>
              Mot de passe:{" "}
              <span style={{ fontFamily: "monospace" }}>
                {createdCreds.tempPassword ?? "inchangé (utilisateur existant)"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Liste</h2>
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          <div style={{ maxWidth: 420 }}>
            <input
              placeholder="Rechercher (nom, username, email, rôle)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ maxWidth: 260 }}>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)} style={inputStyle}>
              <option value="all">Tous les rôles</option>
              <option value="player">Joueurs</option>
              <option value="parent">Parents</option>
              <option value="coach">Coachs</option>
              <option value="manager">Managers</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {totalItems === 0 ? "0 résultat" : `${pageStart}-${pageEnd} sur ${totalItems}`}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13 }}>
                Par page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={{ ...inputStyle, padding: "6px 10px", borderRadius: 10 }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <button className="btn" type="button" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Précédent
              </button>
              <div style={{ fontSize: 13, fontWeight: 700, minWidth: 70, textAlign: "center" }}>
                Page {currentPage}/{totalPages}
              </div>
              <button
                className="btn"
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Suivant
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <ListLoadingBlock label="Chargement..." />
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Aucun utilisateur.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {paginated.map((m) => {
              const isEditing = editingId === m.id;
              const isPlayerProfileEdit = (form.role ?? m.role) === "player";
              const isParentProfileEdit = (form.role ?? m.role) === "parent";

              return (
                <div
                  key={m.id}
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
                        <div style={{ fontWeight: 900 }}>{labelName(m)}</div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          username: {m.profiles?.username ?? "—"} • rôle: {m.role}
                        </div>
                        {(m.role === "manager" || m.role === "coach") && m.profiles?.staff_function ? (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            fonction: {m.profiles.staff_function}
                          </div>
                        ) : null}
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          club: {clubNamesById[m.club_id] ?? m.club_id}
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          statut: {m.is_active ? "actif" : "archivé"}
                        </div>
                        {m.role === "player" && (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            mode performance: {m.is_performance ? "oui" : "non"}
                          </div>
                        )}
                      </div>

                      <button className="btn" onClick={() => startEdit(m)}>
                        Éditer
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Prénom</span>
                          <input
                            placeholder="Prénom"
                            value={(form.first_name ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                            style={inputStyle}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Nom</span>
                          <input
                            placeholder="Nom"
                            value={(form.last_name ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                            style={inputStyle}
                          />
                        </label>
                      </div>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>Username</span>
                        <input
                          placeholder="Username"
                          value={(form.username ?? "") as string}
                          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                          style={inputStyle}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>Adresse e-mail</span>
                        <input
                          placeholder="Adresse e-mail"
                          type="email"
                          value={(form.auth_email ?? "") as string}
                          onChange={(e) => setForm((f) => ({ ...f, auth_email: e.target.value }))}
                          style={inputStyle}
                        />
                      </label>
                      {(form.role === "manager" || form.role === "coach") ? (
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Fonction</span>
                          <input
                            placeholder="Fonction"
                            value={(form.staff_function ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, staff_function: e.target.value }))}
                            style={inputStyle}
                          />
                        </label>
                      ) : null}
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Nouveau mot de passe</span>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(220px, 360px) auto",
                            gap: 8,
                            alignItems: "center",
                            maxWidth: 520,
                          }}
                        >
                          <input
                            placeholder="Nouveau mot de passe (min 8)"
                            type="text"
                            value={(form.auth_password ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, auth_password: e.target.value }))}
                            style={inputStyle}
                          />
                          <button
                            className="btn"
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, auth_password: generatePassword(12) }))}
                            style={{ padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}
                          >
                            Générer
                          </button>
                        </div>
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>Rôle</span>
                        <select
                          value={(form.role ?? "player") as string}
                          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as any }))}
                          style={inputStyle}
                        >
                          <option value="player">Joueur</option>
                          <option value="coach">Coach</option>
                          <option value="manager">Manager</option>
                          <option value="parent">Parent</option>
                        </select>
                      </label>

                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(form.is_active)}
                          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                        />
                        Actif
                      </label>

                      {isPlayerProfileEdit && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(form.is_performance)}
                            onChange={(e) => setForm((f) => ({ ...f, is_performance: e.target.checked }))}
                          />
                          Mode performance
                        </label>
                      )}

                      {isPlayerProfileEdit && (
                        <>
                          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>Profil joueur</div>

                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                            <input
                              type="date"
                              value={(form.birth_date ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
                              style={inputStyle}
                            />
                            <select
                              value={(form.sex ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}
                              style={inputStyle}
                            >
                              <option value="">Sexe</option>
                              <option value="male">Homme</option>
                              <option value="female">Femme</option>
                              <option value="other">Autre</option>
                            </select>
                          </div>

                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
                            <select
                              value={(form.handedness ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, handedness: e.target.value }))}
                              style={inputStyle}
                            >
                              <option value="">Latéralité</option>
                              <option value="right">Droitier</option>
                              <option value="left">Gaucher</option>
                            </select>
                            <input
                              placeholder="Handicap (ex: 12.4 ou AP)"
                              value={(form.handicap ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, handicap: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="Téléphone"
                              value={(form.phone ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>

                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr" }}>
                            <input
                              placeholder="Adresse"
                              value={(form.address ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="NPA"
                              value={(form.postal_code ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="Ville"
                              value={(form.city ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>

                          <input
                            placeholder="No AVS"
                            value={(form.avs_no ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, avs_no: e.target.value }))}
                            style={inputStyle}
                          />
                        </>
                      )}

                      {isParentProfileEdit && (
                        <>
                          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>Contact parent</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                            <input
                              placeholder="Email login"
                              value={(form.auth_email ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, auth_email: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>
                          <input
                            placeholder="Téléphone"
                            value={(form.phone ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                            style={inputStyle}
                          />
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr" }}>
                            <input
                              placeholder="Adresse"
                              value={(form.address ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="NPA"
                              value={(form.postal_code ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="Ville"
                              value={(form.city ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>
                        </>
                      )}

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn" onClick={saveEdit} disabled={savingId === m.id}>
                          {savingId === m.id ? "Sauvegarde…" : "Sauvegarder"}
                        </button>
                        <button className="btn" onClick={cancelEdit} disabled={savingId === m.id}>
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
