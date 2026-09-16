"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Pencil, Plus, RefreshCw, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import campStyles from "@/app/manager/camps/Camps.module.css";

type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };

const formatDate = (value: string) => new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));

export default function ManagerSeasonsPage() {
  const [clubId, setClubId] = useState(""); const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(""); const [editingName, setEditingName] = useState(""); const [updatingId, setUpdatingId] = useState("");
  const [name, setName] = useState(""); const [startsOn, setStartsOn] = useState(""); const [endsOn, setEndsOn] = useState(""); const [isCurrent, setIsCurrent] = useState(true);
  async function headers() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }
  async function load(id: string) { setLoading(true); try { const response = await fetch(`/api/manager/clubs/${id}/seasons`, { headers: await headers() }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setSeasons(json.seasons ?? []); } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de charger les saisons."); } finally { setLoading(false); } }
  useEffect(() => { void (async () => { const response = await fetch("/api/manager/my-clubs", { headers: await headers() }); const json = await response.json(); const first = json.clubs?.[0]?.id ?? ""; setClubId(first); if (first) await load(first); else setLoading(false); })();
    // The club is resolved once when this manager page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function create(event: React.FormEvent) { event.preventDefault(); setError(""); setMessage(""); if (!name || !startsOn || !endsOn) return setError("Complétez le nom et les dates."); if (endsOn < startsOn) return setError("La date de fin doit être postérieure au début."); setSaving(true); try { const response = await fetch(`/api/manager/clubs/${clubId}/seasons`, { method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ name, starts_on: startsOn, ends_on: endsOn, is_current: isCurrent }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setName(""); setStartsOn(""); setEndsOn(""); setIsCurrent(false); setMessage("La saison a été créée."); await load(clubId); } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de créer la saison."); } finally { setSaving(false); } }
  function startEditing(season: Season) { setError(""); setMessage(""); setEditingId(season.id); setEditingName(season.name); }
  function cancelEditing() { setEditingId(""); setEditingName(""); }
  async function updateName(event: React.FormEvent, season: Season) {
    event.preventDefault(); const nextName = editingName.trim(); setError(""); setMessage("");
    if (!nextName) return setError("Le nom de la saison est obligatoire.");
    if (nextName === season.name) { cancelEditing(); return; }
    setUpdatingId(season.id);
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/seasons`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ season_id: season.id, name: nextName }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      setSeasons((current) => current.map((item) => item.id === season.id ? { ...item, name: json.season.name } : item));
      cancelEditing(); setMessage("Le nom de la saison a été modifié.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de modifier la saison."); }
    finally { setUpdatingId(""); }
  }
  return <div className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>Gestion des utilisateurs / Saisons</nav>
    <div className={styles.topline}><div><h1>Saisons</h1><p className={styles.lead}>Définissez la saison de référence des juniors.</p></div></div>
    {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}
    {message ? <div className={actionStyles.successAlert} role="status">{message}</div> : null}
    <section className={styles.overview}><div className={styles.sectionHeading}><div><h2>Saisons configurées</h2><p>La saison en cours sert de contexte à la liste des juniors.</p></div></div>{loading ? <ListLoadingBlock label="Chargement des saisons…" /> : seasons.length === 0 ? <div className="marketplace-empty">Aucune saison configurée pour ce club.</div> : <div className={styles.quickGrid}>{seasons.map((season) => <article key={season.id} className={styles.quickLink}>
      <span><CalendarDays size={18} /></span>
      {editingId === season.id ? <form className={styles.quickLinkEditForm} onSubmit={(event) => void updateName(event, season)}>
        <div className={styles.quickLinkEditContent}><label className="user-mgmt-field"><span className="user-mgmt-field-label">Nom de la saison</span><input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} disabled={updatingId === season.id} /></label><small>{formatDate(season.starts_on)} — {formatDate(season.ends_on)}</small></div>
        <aside className={`${styles.quickLinkActions} ${styles.quickLinkEditActions}`}><button type="submit" className={`${campStyles.iconButton} ${styles.seasonIconButton}`} title="Enregistrer" aria-label={`Enregistrer le nom de ${season.name}`} disabled={updatingId === season.id || !editingName.trim()}>{updatingId === season.id ? <RefreshCw size={15} className={styles.spin} /> : <Save size={15} />}</button><button type="button" className={`${campStyles.iconButton} ${styles.seasonIconButton}`} title="Annuler" aria-label="Annuler la modification" onClick={cancelEditing} disabled={updatingId === season.id}><X size={15} /></button></aside>
      </form> : <><div><b>{season.name}{season.is_current ? " · En cours" : ""}</b><small>{formatDate(season.starts_on)} — {formatDate(season.ends_on)}</small></div><aside className={styles.quickLinkActions}><button type="button" className={`${campStyles.iconButton} ${styles.seasonIconButton}`} title="Modifier le nom" aria-label={`Modifier le nom de ${season.name}`} onClick={() => startEditing(season)} disabled={Boolean(updatingId)}><Pencil size={15} /></button></aside></>}
    </article>)}</div>}</section>
    <section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>Nouvelle saison</h2><p>Une seule saison peut être en cours.</p></div></div><form onSubmit={create} style={{ display: "grid", gap: 16 }}><label className="user-mgmt-field"><span className="user-mgmt-field-label">Nom</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="2026–2027" /></label><div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}><label className="user-mgmt-field"><span className="user-mgmt-field-label">Début</span><input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">Fin</span><input required type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div><label className="pill-soft"><input type="checkbox" checked={isCurrent} onChange={(event) => setIsCurrent(event.target.checked)} /> Définir comme saison en cours</label><div><button type="submit" className="btn" disabled={saving}>{saving ? <RefreshCw size={14} className={styles.spin} /> : <Plus size={14} />}{saving ? "Création…" : "Créer la saison"}</button></div></form></section>
  </div>;
}
