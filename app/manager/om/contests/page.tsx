"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "../OrderOfMerit.module.css";

type ManagedClub = { id: string; name: string };
type Group = { id: string; name: string | null; is_active: boolean | null; club_season_id: string | null };
type Contest = {
  id: string;
  organization_id: string;
  group_id: string | null;
  title: string;
  description: string | null;
  contest_date: string;
  full_ranking: unknown;
};

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function hasPublishedRanking(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function isStandardGroup(group: Group) {
  const name = String(group.name ?? "").trim();
  return (
    group.is_active !== false &&
    Boolean(group.club_season_id) &&
    !name.startsWith("__ARCHIVE_") &&
    name !== "Groupe spécifique" &&
    !name.startsWith("__EVENT_SPECIFIQUE__")
  );
}

export default function ManagerInternalContestsPage() {
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clubs, setClubs] = useState<ManagedClub[]>([]);
  const [clubId, setClubId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [contests, setContests] = useState<Contest[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [groupId, setGroupId] = useState("");

  async function authHeaders() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadClubs() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { clubs?: ManagedClub[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Impossible de charger les clubs.");
      const nextClubs = Array.isArray(payload.clubs)
        ? payload.clubs.map((club) => ({ id: String(club.id), name: String(club.name ?? "Club") })).filter((club) => club.id)
        : [];
      setClubs(nextClubs);
      setClubId((current) => current || nextClubs[0]?.id || "");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Impossible de charger les clubs.");
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    if (!clubId) {
      setGroups([]);
      setContests([]);
      return;
    }
    setLoading(true);
    setError(null);
    const [groupsResponse, contestsResponse] = await Promise.all([
      supabase.from("coach_groups").select("id,name,is_active,club_season_id").eq("club_id", clubId).order("name"),
      supabase.from("om_internal_contests")
        .select("id,organization_id,group_id,title,description,contest_date,full_ranking")
        .eq("organization_id", clubId).order("contest_date", { ascending: false }),
    ]);
    setLoading(false);
    if (groupsResponse.error || contestsResponse.error) {
      setError(groupsResponse.error?.message ?? contestsResponse.error?.message ?? "Impossible de charger les concours.");
      return;
    }
    setGroups((groupsResponse.data ?? []) as Group[]);
    setContests((contestsResponse.data ?? []) as Contest[]);
  }

  async function createContest() {
    if (!clubId || !title.trim() || !date) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const response = await supabase.from("om_internal_contests").insert({
      organization_id: clubId,
      group_id: groupId || null,
      title: title.trim(),
      description: description.trim() || null,
      contest_date: date,
    });
    setSaving(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setTitle("");
    setDescription("");
    setDate(today);
    setGroupId("");
    setFormOpen(false);
    setSuccess("Le concours interne a été créé.");
    await loadData();
  }

  async function deleteContest(contest: Contest) {
    if (!window.confirm(`Supprimer le concours « ${contest.title} » et son classement ?`)) return;
    setBusyId(contest.id);
    setError(null);
    setSuccess(null);
    const response = await supabase.from("om_internal_contests").delete().eq("id", contest.id);
    setBusyId(null);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setSuccess("Le concours interne a été supprimé.");
    await loadData();
  }

  useEffect(() => {
    void loadClubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group.name || "Sans nom"])), [groups]);
  const standardGroups = useMemo(() => groups.filter(isStandardGroup), [groups]);
  const publishedCount = contests.filter((contest) => hasPublishedRanking(contest.full_ranking)).length;

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d'Ariane"><Link href="/manager">Manager</Link><ChevronRight size={13} /><span>Ordre du mérite</span><ChevronRight size={13} /><span>Concours internes</span></nav>
      <div className={styles.topline}>
        <div><h1>Concours internes</h1><p className={styles.lead}>Créez les concours du club puis publiez leur classement pour attribuer automatiquement les points correspondants.</p></div>
        <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => setFormOpen((current) => !current)}><Plus size={16} />Nouveau concours</button></div>
      </div>
      {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
      {success ? <div className={styles.alertSuccess} role="status">{success}</div> : null}
      <section className={styles.stats} aria-label="Statistiques des concours">
        <div className={styles.stat}><span>Total</span><b>{contests.length}</b></div>
        <div className={styles.stat}><span>Classements publiés</span><b>{publishedCount}</b></div>
        <div className={styles.stat}><span>À compléter</span><b>{contests.length - publishedCount}</b></div>
        <div className={styles.stat}><span>Groupes disponibles</span><b>{standardGroups.length}</b></div>
      </section>
      {formOpen ? <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Créer un concours interne</h2><p>Le classement et les résultats seront renseignés après la création.</p></div></div>
        <div className={styles.grid2}>
          <label className={styles.field}><span>Titre</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex. Concours de putting" /></label>
          <label className={styles.field}><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className={styles.field}><span>Groupe concerné</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Tous les joueurs</option>{standardGroups.map((group) => <option key={group.id} value={group.id}>{group.name ?? "Sans nom"}</option>)}</select></label>
          <label className={styles.field}><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Informations utiles pour le concours" /></label>
        </div>
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setFormOpen(false)} disabled={saving}>Annuler</button><button type="button" className={styles.primary} onClick={() => void createContest()} disabled={saving || !clubId || !title.trim() || !date}>{saving ? "Création..." : "Créer le concours"}</button></div>
      </section> : null}
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Liste des concours internes</h2><p>{contests.length} concours enregistré{contests.length > 1 ? "s" : ""}.</p></div></div>
        {clubs.length > 1 ? <label className={styles.field} style={{ maxWidth: 300 }}><span>Club</span><select value={clubId} onChange={(event) => setClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label> : null}
        {loading ? <ListLoadingBlock label="Chargement des concours..." /> : contests.length === 0 ? <div className={styles.empty}>Aucun concours interne pour le moment.</div> : <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Date</th><th>Concours</th><th>Groupe</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{contests.map((contest) => {
            const published = hasPublishedRanking(contest.full_ranking);
            return <tr key={contest.id}><td data-label="Date">{formatDate(contest.contest_date)}</td><td data-label="Concours"><div className={styles.titleCell}><b>{contest.title}</b>{contest.description ? <span className={styles.muted}>{contest.description}</span> : null}</div></td><td data-label="Groupe">{contest.group_id ? groupById.get(contest.group_id) ?? "Groupe" : "Tous les joueurs"}</td><td data-label="Statut"><span className={`${styles.badge} ${published ? "" : styles.badgeMuted}`}>{published ? "Publié" : "À compléter"}</span></td><td data-label="Actions"><div className={styles.actions}><Link className={styles.iconButton} title="Gérer le classement" aria-label={`Gérer le classement de ${contest.title}`} href={`/manager/om/contests/${contest.id}`}><Pencil size={15} /></Link><button type="button" className={`${styles.iconButton} ${styles.dangerIcon}`} title="Supprimer" aria-label={`Supprimer ${contest.title}`} disabled={busyId === contest.id} onClick={() => void deleteContest(contest)}><Trash2 size={15} /></button></div></td></tr>;
          })}</tbody>
        </table></div>}
      </section>
    </main>
  );
}
