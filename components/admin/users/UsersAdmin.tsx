"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Filter, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./UsersAdmin.module.css";

type UserRow = { id: string; email: string | null; first_name: string | null; last_name: string | null; username: string | null; organization: string | null; role: "manager" | null };

export default function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdCreds, setCreatedCreds] = useState<{ username: string; password: string } | null>(null);
  const [createForm, setCreateForm] = useState({ firstName: "", lastName: "", email: "" });
  const [query, setQuery] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", username: "", password: "" });

  const canCreate = createForm.firstName.trim().length > 0 && createForm.lastName.trim().length > 0;

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function request(input: RequestInfo | URL, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    finally { window.clearTimeout(timer); }
  }

  async function loadUsers() {
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session. Reconnecte-toi.");
      const response = await request("/api/admin/users/list", { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result?.error ?? "Erreur de chargement"));
      setUsers((result?.users ?? []) as UserRow[]);
    } catch (cause: unknown) {
      setError(cause instanceof Error && cause.name === "AbortError" ? "Délai dépassé. Réessaie." : cause instanceof Error ? cause.message : "Erreur de chargement");
      setUsers([]);
    } finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadUsers(); }, []);

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    return users.filter((user) => !normalized || [user.first_name ?? "", user.last_name ?? "", user.username ?? "", user.organization ?? ""].some((value) => value.toLocaleLowerCase("fr").includes(normalized)));
  }, [query, users]);
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const visibleUsers = filteredUsers.slice((tablePage - 1) * pageSize, tablePage * pageSize);

  async function createManager(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate || busy) return;
    setBusy(true); setError(null); setCreatedCreds(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session. Reconnecte-toi.");
      const response = await request("/api/admin/create-user", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ first_name: createForm.firstName.trim(), last_name: createForm.lastName.trim(), email: createForm.email.trim().toLowerCase(), role: "manager" }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result?.error ?? "Erreur de création"));
      setCreatedCreds({ username: String(result?.username ?? ""), password: String(result?.tempPassword ?? "") });
      setCreateForm({ firstName: "", lastName: "", email: "" });
      await loadUsers();
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Erreur de création"); }
    finally { setBusy(false); }
  }

  function startEdit(user: UserRow) {
    setEditingId(user.id);
    setEditForm({ firstName: user.first_name ?? "", lastName: user.last_name ?? "", username: user.username ?? "", password: "" });
  }

  async function saveEdit(user: UserRow) {
    setSavingId(user.id); setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session. Reconnecte-toi.");
      const response = await request("/api/admin/users/update", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ userId: user.id, first_name: editForm.firstName.trim() || null, last_name: editForm.lastName.trim() || null, username: editForm.username.trim().toLowerCase() || null, role: "manager", auth_password: editForm.password || null }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result?.error ?? "Erreur de sauvegarde"));
      setEditingId(null); await loadUsers();
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Erreur de sauvegarde"); }
    finally { setSavingId(null); }
  }

  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">Administration</Link><ChevronRight size={14} aria-hidden="true" /><span>Managers</span></nav>
    <h1 className={styles.pageTitle}>Managers</h1>
    {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}

    <section className={styles.formPanel}>
      <div className={styles.panelHeader}><div><h2>Créer un manager</h2><span>Accès administration</span></div></div>
      <form className={styles.formGrid} onSubmit={createManager}>
        <label className={styles.field}><span>Prénom</span><input value={createForm.firstName} onChange={(event) => setCreateForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="Prénom" disabled={busy} /></label>
        <label className={styles.field}><span>Nom</span><input value={createForm.lastName} onChange={(event) => setCreateForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Nom" disabled={busy} /></label>
        <label className={styles.field}><span>Adresse e-mail</span><input type="email" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} placeholder="nom@organisation.ch" disabled={busy} /></label>
        <div className={styles.submitField}><button className={styles.primaryButton} disabled={!canCreate || busy} type="submit"><Plus size={16} /> {busy ? "Création…" : "Créer le manager"}</button></div>
      </form>
      {createdCreds ? <div className={styles.successAlert}><strong>Manager créé.</strong><span> Identifiant : {createdCreds.username}</span>{createdCreds.password ? <span> · Mot de passe temporaire : {createdCreds.password}</span> : null}</div> : null}
    </section>

    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}><div><h2>Managers enregistrés</h2><span>Liste</span></div></div>
      <div className={styles.tableToolbar}><label className={styles.tableSearch}><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setTablePage(1); }} placeholder="Rechercher un manager" aria-label="Rechercher un manager" /></label><label className={styles.tableFilter}><Filter size={14} aria-hidden="true" /><span>Managers</span></label></div>
      {loading ? <div className={styles.emptyState}>Chargement des managers…</div> : filteredUsers.length === 0 ? <div className={styles.emptyState}>Aucun manager ne correspond à votre recherche.</div> : <>
        <div className={styles.tableFrame}><table className={styles.table}><thead><tr><th>Nom</th><th>Prénom</th><th>Identifiant</th><th>Organisation</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map((user, index) => {
          const editing = editingId === user.id;
          return <tr key={user.id} className={`${index % 2 === 1 ? styles.alternateRow : ""} ${editing ? styles.editingRow : ""}`}><td data-label="Nom">{editing ? <input className={styles.rowInput} value={editForm.lastName} onChange={(event) => setEditForm((current) => ({ ...current, lastName: event.target.value }))} /> : <strong>{user.last_name ?? "—"}</strong>}</td><td data-label="Prénom">{editing ? <input className={styles.rowInput} value={editForm.firstName} onChange={(event) => setEditForm((current) => ({ ...current, firstName: event.target.value }))} /> : user.first_name ?? "—"}</td><td data-label="Identifiant">{editing ? <input className={styles.rowInput} value={editForm.username} onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value }))} /> : <code>{user.username ?? "—"}</code>}</td><td data-label="Organisation">{user.organization ?? "—"}</td><td className={styles.actionCell}>{editing ? <div className={styles.editStack}><input className={styles.passwordInput} type="password" value={editForm.password} placeholder="Nouveau mot de passe" onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))} /><div className={styles.rowActions}><button type="button" className={styles.primarySmallButton} disabled={savingId === user.id} onClick={() => saveEdit(user)}>{savingId === user.id ? "Sauvegarde…" : "Enregistrer"}</button><button type="button" className={styles.textButton} disabled={savingId === user.id} onClick={() => setEditingId(null)}>Annuler</button></div></div> : <div className={styles.rowActions}><button type="button" className={styles.secondaryButton} onClick={() => startEdit(user)}>Éditer</button></div>}</td></tr>;
        })}</tbody></table></div>
        <div className={styles.tableFooter}><span>{`${((tablePage - 1) * pageSize) + 1}-${Math.min(tablePage * pageSize, filteredUsers.length)} sur ${filteredUsers.length}`}</span><div className={styles.pagination}><button type="button" disabled={tablePage === 1} onClick={() => setTablePage((current) => Math.max(1, current - 1))}>Précédent</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => <button type="button" key={page} aria-current={page === tablePage ? "page" : undefined} onClick={() => setTablePage(page)}>{page}</button>)}<button type="button" disabled={tablePage === totalPages} onClick={() => setTablePage((current) => Math.min(totalPages, current + 1))}>Suivant</button></div></div>
      </>}
    </section>
  </div>;
}
