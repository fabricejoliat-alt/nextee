"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, CirclePower, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "../OrderOfMerit.module.css";

type ManagedClub = { id: string; name: string };
type Tournament = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
};

function formatDate(value: string | null) {
  if (!value) return "À définir";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function dateRange(row: Tournament) {
  if (!row.starts_on && !row.ends_on) return "Dates à définir";
  if (!row.ends_on || row.starts_on === row.ends_on) return formatDate(row.starts_on ?? row.ends_on);
  return `${formatDate(row.starts_on)} – ${formatDate(row.ends_on)}`;
}

export default function ManagerExceptionalTournamentsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clubs, setClubs] = useState<ManagedClub[]>([]);
  const [clubId, setClubId] = useState("");
  const [rows, setRows] = useState<Tournament[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

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

  async function loadRows() {
    if (!clubId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await supabase.from("om_exceptional_tournaments")
      .select("id,organization_id,name,description,starts_on,ends_on,is_active")
      .eq("organization_id", clubId).order("starts_on", { ascending: false, nullsFirst: false });
    setLoading(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setRows((response.data ?? []) as Tournament[]);
  }

  async function createTournament() {
    if (!clubId || !name.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const response = await supabase.from("om_exceptional_tournaments").insert({
      organization_id: clubId,
      name: name.trim(),
      description: description.trim() || null,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      is_active: true,
    });
    setSaving(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setName("");
    setDescription("");
    setStartsOn("");
    setEndsOn("");
    setFormOpen(false);
    setSuccess("Le tournoi exceptionnel a été ajouté.");
    await loadRows();
  }

  async function toggleTournament(row: Tournament) {
    setBusyId(row.id);
    setError(null);
    setSuccess(null);
    const response = await supabase.from("om_exceptional_tournaments").update({ is_active: !row.is_active }).eq("id", row.id);
    setBusyId(null);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setSuccess(row.is_active ? "Le tournoi a été désactivé." : "Le tournoi a été activé.");
    await loadRows();
  }

  async function deleteTournament(row: Tournament) {
    if (!window.confirm(`Supprimer le tournoi exceptionnel « ${row.name} » ?`)) return;
    setBusyId(row.id);
    setError(null);
    setSuccess(null);
    const response = await supabase.from("om_exceptional_tournaments").delete().eq("id", row.id);
    setBusyId(null);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setSuccess("Le tournoi exceptionnel a été supprimé.");
    await loadRows();
  }

  useEffect(() => {
    void loadClubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const activeCount = rows.filter((row) => row.is_active).length;
  const datedCount = rows.filter((row) => row.starts_on).length;

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d'Ariane"><Link href="/manager">Manager</Link><ChevronRight size={13} /><span>Ordre du mérite</span><ChevronRight size={13} /><span>Tournois exceptionnels</span></nav>
      <div className={styles.topline}>
        <div><h1>Tournois exceptionnels</h1><p className={styles.lead}>Définissez les compétitions reconnues comme exceptionnelles dans le calcul de l’ordre du mérite.</p></div>
        <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => setFormOpen((current) => !current)}><Plus size={16} />Ajouter un tournoi</button></div>
      </div>
      {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
      {success ? <div className={styles.alertSuccess} role="status">{success}</div> : null}
      <section className={styles.stats} aria-label="Statistiques des tournois exceptionnels">
        <div className={styles.stat}><span>Total</span><b>{rows.length}</b></div>
        <div className={styles.stat}><span>Actifs</span><b>{activeCount}</b></div>
        <div className={styles.stat}><span>Inactifs</span><b>{rows.length - activeCount}</b></div>
        <div className={styles.stat}><span>Avec dates</span><b>{datedCount}</b></div>
      </section>
      {formOpen ? <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Ajouter un tournoi exceptionnel</h2><p>Les dates sont facultatives mais facilitent l’identification de la compétition.</p></div></div>
        <div className={styles.grid2}>
          <label className={styles.field}><span>Nom</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom du tournoi" /></label>
          <label className={styles.field}><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Remarque ou contexte" /></label>
          <label className={styles.field}><span>Date de début</span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
          <label className={styles.field}><span>Date de fin</span><input type="date" min={startsOn || undefined} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label>
        </div>
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setFormOpen(false)} disabled={saving}>Annuler</button><button type="button" className={styles.primary} onClick={() => void createTournament()} disabled={saving || !clubId || !name.trim()}>{saving ? "Ajout..." : "Ajouter le tournoi"}</button></div>
      </section> : null}
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Liste des tournois exceptionnels</h2><p>{rows.length} tournoi{rows.length > 1 ? "s" : ""} enregistré{rows.length > 1 ? "s" : ""}.</p></div></div>
        {clubs.length > 1 ? <label className={styles.field} style={{ maxWidth: 300 }}><span>Club</span><select value={clubId} onChange={(event) => setClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label> : null}
        {loading ? <ListLoadingBlock label="Chargement des tournois..." /> : rows.length === 0 ? <div className={styles.empty}>Aucun tournoi exceptionnel pour le moment.</div> : <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Tournoi</th><th>Dates</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td data-label="Tournoi"><div className={styles.titleCell}><b>{row.name}</b>{row.description ? <span className={styles.muted}>{row.description}</span> : null}</div></td><td data-label="Dates">{dateRange(row)}</td><td data-label="Statut"><span className={`${styles.badge} ${row.is_active ? "" : styles.badgeMuted}`}>{row.is_active ? "Actif" : "Inactif"}</span></td><td data-label="Actions"><div className={styles.actions}><button type="button" className={styles.iconButton} title={row.is_active ? "Désactiver" : "Activer"} aria-label={`${row.is_active ? "Désactiver" : "Activer"} ${row.name}`} disabled={busyId === row.id} onClick={() => void toggleTournament(row)}><CirclePower size={15} /></button><button type="button" className={`${styles.iconButton} ${styles.dangerIcon}`} title="Supprimer" aria-label={`Supprimer ${row.name}`} disabled={busyId === row.id} onClick={() => void deleteTournament(row)}><Trash2 size={15} /></button></div></td></tr>)}</tbody>
        </table></div>}
      </section>
    </main>
  );
}
