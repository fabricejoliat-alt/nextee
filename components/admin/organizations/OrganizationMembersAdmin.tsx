"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Building2, ChevronRight, Filter, Plus, Search, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./OrganizationMembersAdmin.module.css";

type Club = { id: string; name: string; slug: string | null };
type Profile = { id: string; first_name: string | null; last_name: string | null };
type ManagerMembership = { id: string; club_id: string; user_id: string; role: "manager"; is_active: boolean | null; created_at: string | null };

function fullName(profile?: Profile | null) {
  if (!profile) return "";
  return `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
}

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date));
}

export default function OrganizationMembersAdmin() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;
  const [club, setClub] = useState<Club | null>(null);
  const [managers, setManagers] = useState<ManagerMembership[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [tablePage, setTablePage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [clubRes, adminsRes, membersRes, usersRes] = await Promise.all([
        supabase.from("clubs").select("id,name,slug").eq("id", organizationId).maybeSingle(),
        supabase.from("app_admins").select("user_id"),
        supabase.from("club_members").select("id,club_id,user_id,role,is_active,created_at").eq("club_id", organizationId).eq("role", "manager").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id,first_name,last_name").order("created_at", { ascending: false }),
      ]);

      if (clubRes.error) throw new Error(clubRes.error.message);
      if (adminsRes.error) throw new Error(adminsRes.error.message);
      if (membersRes.error) throw new Error(membersRes.error.message);
      if (usersRes.error) throw new Error(usersRes.error.message);

      setClub(clubRes.data ?? null);
      const adminIds = new Set(((adminsRes.data ?? []) as Array<{ user_id: string | null }>).map((row) => row.user_id).filter(Boolean) as string[]);
      const managerRows = ((membersRes.data ?? []) as ManagerMembership[]).filter((member) => !adminIds.has(member.user_id));
      setManagers(managerRows);

      const users = ((usersRes.data ?? []) as Profile[]).filter((user) => !adminIds.has(user.id));
      setAllUsers(users);
      setProfilesById(Object.fromEntries(users.map((user) => [user.id, user])));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (organizationId) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const managerUserIds = useMemo(() => new Set(managers.map((manager) => manager.user_id)), [managers]);
  const addableUsers = useMemo(() => allUsers.filter((user) => !managerUserIds.has(user.id)).sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")), [allUsers, managerUserIds]);
  const filteredManagers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr");
    return managers.filter((manager) => {
      const active = manager.is_active !== false;
      const matchesQuery = !normalizedQuery || fullName(profilesById[manager.user_id]).toLocaleLowerCase("fr").includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? active : !active);
      return matchesQuery && matchesStatus;
    });
  }, [managers, profilesById, query, statusFilter]);
  const tablePageSize = 8;
  const tableTotalPages = Math.max(1, Math.ceil(filteredManagers.length / tablePageSize));
  const visibleManagers = filteredManagers.slice((tablePage - 1) * tablePageSize, tablePage * tablePageSize);

  async function addManager(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedUserId || busy) return;
    setError(null);
    const picked = allUsers.find((user) => user.id === selectedUserId);
    const pickedName = fullName(picked) || "cet utilisateur";
    if (!window.confirm(`Ajouter ${pickedName} comme manager de cette organisation ?`)) return;

    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session. Reconnecte-toi.");
      const response = await fetch(`/api/admin/clubs/${organizationId}/add-existing-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: selectedUserId, role: "manager" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result?.error ?? "Erreur lors de l’ajout du manager"));
      setSelectedUserId("");
      await loadAll();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Erreur lors de l’ajout du manager");
    } finally {
      setBusy(false);
    }
  }

  async function updateManagerStatus(manager: ManagerMembership) {
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.from("club_members").update({ is_active: manager.is_active === false }).eq("id", manager.id).eq("role", "manager");
      if (updateError) throw new Error(updateError.message);
      setManagers((current) => current.map((item) => item.id === manager.id ? { ...item, is_active: manager.is_active === false } : item));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Erreur de mise à jour");
    } finally {
      setBusy(false);
    }
  }

  async function removeManager(manager: ManagerMembership) {
    if (!window.confirm(`Retirer ${fullName(profilesById[manager.user_id]) || "ce manager"} de l’organisation ?`)) return;
    setBusy(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase.from("club_members").delete().eq("id", manager.id).eq("role", "manager");
      if (deleteError) throw new Error(deleteError.message);
      setManagers((current) => current.filter((item) => item.id !== manager.id));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Erreur de suppression");
    } finally {
      setBusy(false);
    }
  }

  if (!organizationId) return <div className={styles.errorAlert} role="alert">Organisation introuvable.</div>;

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
        <Link href="/admin">Administration</Link><ChevronRight size={14} aria-hidden="true" />
        <Link href="/admin/organizations">Organisations</Link><ChevronRight size={14} aria-hidden="true" />
        <span>{club?.name ?? "Organisation"}</span>
      </nav>
      <div className={styles.titleRow}>
        <h1 className={styles.pageTitle}>{club?.name ?? "Organisation"}</h1>
        <Link href={`/admin/organizations/${organizationId}/settings`} className={styles.settingsButton}><Settings2 size={16} /> Paramètres</Link>
      </div>
      {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}

      <section className={styles.formPanel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelIcon}><Building2 size={20} /></div>
          <div><h2>Ajouter un manager</h2></div>
        </div>
        <form className={styles.formGrid} onSubmit={addManager}>
          <label className={styles.field}><span>Utilisateur</span><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} disabled={busy}><option value="">— Sélectionner un utilisateur —</option>{addableUsers.map((user) => <option key={user.id} value={user.id}>{fullName(user) || "Sans nom"}</option>)}</select></label>
          <div className={styles.submitField}><button type="submit" className={styles.primaryButton} disabled={!selectedUserId || busy}><Plus size={16} /> Ajouter le manager</button></div>
        </form>
        {addableUsers.length === 0 ? <p className={styles.helper}>Aucun utilisateur disponible à ajouter.</p> : null}
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}><div><h2>Managers de l’organisation</h2><span>Liste</span></div></div>
        <div className={styles.tableToolbar}>
          <label className={styles.tableSearch}><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setTablePage(1); }} placeholder="Rechercher un manager" aria-label="Rechercher un manager" /></label>
          <label className={styles.tableFilter}><Filter size={14} aria-hidden="true" /><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "all" | "active" | "inactive"); setTablePage(1); }} aria-label="Filtrer par statut"><option value="all">Tous les statuts</option><option value="active">Actifs</option><option value="inactive">Désactivés</option></select></label>
        </div>
        {loading ? <div className={styles.emptyState}>Chargement des managers…</div> : filteredManagers.length === 0 ? <div className={styles.emptyState}>Aucun manager ne correspond à votre recherche.</div> : <>
          <div className={styles.tableFrame}><table className={styles.table}><thead><tr><th>Nom</th><th>Prénom</th><th>Rôle</th><th>Statut</th><th>Ajouté le</th><th>Actions</th></tr></thead><tbody>{visibleManagers.map((manager, index) => {
            const profile = profilesById[manager.user_id];
            const active = manager.is_active !== false;
            return <tr key={manager.id} className={index % 2 === 1 ? styles.alternateRow : undefined}><td data-label="Nom"><strong>{profile?.last_name ?? "—"}</strong></td><td data-label="Prénom">{profile?.first_name ?? "—"}</td><td data-label="Rôle"><span className={styles.roleTag}>Manager</span></td><td data-label="Statut"><span className={active ? styles.statusActive : styles.statusInactive}>{active ? "Actif" : "Désactivé"}</span></td><td data-label="Ajouté le">{formatDate(manager.created_at)}</td><td className={styles.actionCell}><div className={styles.rowActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => updateManagerStatus(manager)}>{active ? "Désactiver" : "Activer"}</button><button type="button" className={styles.deleteButton} disabled={busy} onClick={() => removeManager(manager)}>Retirer</button></div></td></tr>;
          })}</tbody></table></div>
          <div className={styles.tableFooter}><span>{`${((tablePage - 1) * tablePageSize) + 1}-${Math.min(tablePage * tablePageSize, filteredManagers.length)} sur ${filteredManagers.length}`}</span><div className={styles.pagination}><button type="button" disabled={tablePage === 1} onClick={() => setTablePage((current) => Math.max(1, current - 1))}>Précédent</button>{Array.from({ length: tableTotalPages }, (_, index) => index + 1).map((page) => <button type="button" key={page} aria-current={page === tablePage ? "page" : undefined} onClick={() => setTablePage(page)}>{page}</button>)}<button type="button" disabled={tablePage === tableTotalPages} onClick={() => setTablePage((current) => Math.min(tableTotalPages, current + 1))}>Suivant</button></div></div>
        </>}
      </section>
    </div>
  );
}
