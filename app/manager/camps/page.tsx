/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Copy, Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "./Camps.module.css";

type CampSummary = {
  id: string; title: string; notes: string | null; status: string; capacity: number | null;
  head_coach: { first_name: string | null; last_name: string | null } | null;
  days: Array<{ starts_at: string | null; ends_at: string | null; counts: Record<string, number> }>;
  stats: { invited: number; registered: number; coaches: number };
  evaluation: { required: number; completed: number };
};
type StageState = "all" | "upcoming" | "in_progress" | "completed" | "draft" | "archived";

function personName(person: CampSummary["head_coach"]) { return `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim() || "Non défini"; }
function campState(camp: CampSummary): Exclude<StageState, "all"> {
  if (camp.status === "archived") return "archived";
  if (camp.status === "draft") return "draft";
  const now = Date.now();
  const starts = camp.days.map((day) => day.starts_at ? new Date(day.starts_at).getTime() : NaN).filter(Number.isFinite);
  const ends = camp.days.map((day) => day.ends_at ? new Date(day.ends_at).getTime() : NaN).filter(Number.isFinite);
  if (!starts.length) return "draft";
  if (now < Math.min(...starts)) return "upcoming";
  if (now <= Math.max(...ends, ...starts)) return "in_progress";
  return "completed";
}
const STATE_LABELS: Record<Exclude<StageState, "all">, string> = { upcoming: "À venir", in_progress: "En cours", completed: "Terminé", draft: "Brouillon", archived: "Archivé" };
function dateRange(camp: CampSummary) {
  const values = camp.days.map((day) => day.starts_at).filter(Boolean).map((value) => new Date(value as string)).sort((a, b) => a.getTime() - b.getTime());
  if (!values.length) return "Dates à définir";
  const format = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "short", year: "numeric" });
  return values.length === 1 ? format.format(values[0]) : `${format.format(values[0])} – ${format.format(values[values.length - 1])}`;
}
function Progress({ value, total }: { value: number; total: number }) {
  const ratio = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return <div className={styles.progress}><span className={styles.muted}>{total > 0 ? `${value}/${total}` : "Non prévu"}</span><div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${ratio}%` }} /></div></div>;
}

export default function ManagerCampsPage() {
  const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampSummary[]>([]); const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StageState>("all"); const [periodFilter, setPeriodFilter] = useState("all");
  async function headers(json = false) { const { data } = await supabase.auth.getSession(); return { ...(json ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${data.session?.access_token ?? ""}` }; }
  async function load() { setLoading(true); setError(null); try { const response = await fetch("/api/manager/camps", { headers: await headers(), cache: "no-store" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(payload?.error ?? "Impossible de charger les stages.")); setCamps(payload?.camps ?? []); } catch (cause: any) { setError(cause?.message ?? "Erreur de chargement."); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function archiveCamp(camp: CampSummary) { if (!window.confirm(`Archiver le stage « ${camp.title} » ?`)) return; setBusyId(camp.id); setError(null); setSuccess(null); try { const response = await fetch(`/api/manager/camps/${camp.id}`, { method: "PATCH", headers: await headers(true), body: JSON.stringify({ action: "archive" }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(payload?.error ?? "Archivage impossible.")); setSuccess("Le stage a été archivé."); await load(); } catch (cause: any) { setError(cause?.message ?? "Archivage impossible."); } finally { setBusyId(null); } }
  const filtered = useMemo(() => camps.filter((camp) => { const state = campState(camp); if (stateFilter !== "all" && state !== stateFilter) return false; if (!camp.title.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr"))) return false; if (periodFilter === "all" || !camp.days.length) return true; const first = Math.min(...camp.days.map((day) => day.starts_at ? new Date(day.starts_at).getTime() : Infinity)); const now = new Date(); if (periodFilter === "month") return new Date(first).getMonth() === now.getMonth() && new Date(first).getFullYear() === now.getFullYear(); return new Date(first).getFullYear() === now.getFullYear(); }), [camps, periodFilter, query, stateFilter]);
  const counts = useMemo(() => ({ upcoming: camps.filter((camp) => campState(camp) === "upcoming").length, inProgress: camps.filter((camp) => campState(camp) === "in_progress").length, completed: camps.filter((camp) => campState(camp) === "completed").length, draft: camps.filter((camp) => campState(camp) === "draft").length }), [camps]);
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/manager">Manager</Link><ChevronRight size={13} /><span>Stages</span></nav>
    <div className={styles.topline}><div><h1>Stages</h1><p className={styles.lead}>Planifiez les journées, l’encadrement, les participations, les évaluations et les options de chaque stage.</p></div><div className={styles.actions}><Link className={styles.primary} href="/manager/camps/new"><Plus size={16} />Créer un stage</Link></div></div>
    {error ? <div className={styles.alertError} role="alert">{error}</div> : null}{success ? <div className={styles.alertSuccess} role="status">{success}</div> : null}
    <section className={styles.stats} aria-label="Statistiques des stages"><div className={styles.stat}><span>À venir</span><b>{counts.upcoming}</b></div><div className={styles.stat}><span>En cours</span><b>{counts.inProgress}</b></div><div className={styles.stat}><span>Terminés</span><b>{counts.completed}</b></div><div className={styles.stat}><span>Brouillons</span><b>{counts.draft}</b></div></section>
    <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Liste des stages</h2><p>{filtered.length} stage{filtered.length > 1 ? "s" : ""} affiché{filtered.length > 1 ? "s" : ""}.</p></div></div>
      <div className={styles.toolbar}><label className={styles.field}><span>Rechercher</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: 13, color: "#7a857b" }} /><input style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom du stage" /></span></label><label className={styles.field}><span>État</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StageState)}><option value="all">Tous les états</option><option value="upcoming">À venir</option><option value="in_progress">En cours</option><option value="completed">Terminés</option><option value="draft">Brouillons</option><option value="archived">Archivés</option></select></label><label className={styles.field}><span>Période</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">Toutes les dates</option><option value="month">Ce mois</option><option value="year">Cette année</option></select></label></div>
      {loading ? <ListLoadingBlock label="Chargement des stages…" /> : filtered.length === 0 ? <div className={styles.empty}>Aucun stage ne correspond aux critères.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Stage</th><th className={styles.compactHeader}>Dates</th><th className={styles.compactHeader}>Head coach</th><th className={styles.compactHeader}>Participants</th><th className={styles.compactHeader}>Capacité</th><th>État</th><th>Présences</th><th>Évaluations</th><th>Actions</th></tr></thead><tbody>{filtered.map((camp) => {
        const state = campState(camp); const attendanceTotal = camp.days.reduce((sum, day) => sum + Object.values(day.counts ?? {}).reduce((a, b) => a + b, 0), 0); const attendanceDone = camp.days.reduce((sum, day) => sum + Number(day.counts?.present ?? 0) + Number(day.counts?.absent ?? 0) + Number(day.counts?.excused ?? 0), 0); const remaining = camp.capacity == null ? null : camp.capacity - camp.stats.invited; const badgeClass = state === "in_progress" ? styles.badgeProgress : state === "completed" ? styles.badgeDone : state === "archived" ? styles.badgeArchived : state === "draft" ? styles.badgeDraft : "";
        return <tr key={camp.id}><td data-label="Stage"><div className={styles.titleCell}><b>{camp.title}</b><span className={styles.muted}>{camp.days.length} journée{camp.days.length > 1 ? "s" : ""}</span></div></td><td data-label="Dates">{dateRange(camp)}</td><td data-label="Head coach">{personName(camp.head_coach)}</td><td data-label="Participants">{camp.stats.invited}</td><td data-label="Capacité">{remaining == null ? "Non définie" : `${Math.max(0, remaining)} place${remaining > 1 ? "s" : ""}`}</td><td data-label="État"><span className={`${styles.badge} ${badgeClass}`}>{STATE_LABELS[state]}</span></td><td data-label="Présences"><Progress value={attendanceDone} total={attendanceTotal} /></td><td data-label="Évaluations"><Progress value={camp.evaluation?.completed ?? 0} total={camp.evaluation?.required ?? 0} /></td><td data-label="Actions"><div className={styles.actions}><Link className={styles.iconButton} title="Consulter" aria-label={`Consulter ${camp.title}`} href={`/manager/camps/${camp.id}`}><Eye size={15} /></Link><Link className={styles.iconButton} title="Modifier" aria-label={`Modifier ${camp.title}`} href={`/manager/camps/new?campId=${camp.id}`}><Pencil size={15} /></Link><Link className={styles.iconButton} title="Dupliquer" aria-label={`Dupliquer ${camp.title}`} href={`/manager/camps/new?duplicateId=${camp.id}`}><Copy size={15} /></Link>{state !== "archived" ? <button className={`${styles.iconButton} ${styles.dangerIcon}`} title="Archiver" aria-label={`Archiver ${camp.title}`} disabled={busyId === camp.id} onClick={() => void archiveCamp(camp)}><Trash2 size={15} /></button> : null}</div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </main>;
}
