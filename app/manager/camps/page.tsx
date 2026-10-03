/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { managerContentPresentation } from "@/lib/managerContentPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import { useI18n } from "@/components/i18n/AppI18nProvider";
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


function Progress({ value, total }: { value: number; total: number }) {
  const { t, locale } = useI18n();
  const ratio = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return <div className={styles.progress}><span className={styles.muted}>{total > 0 ? `${value.toLocaleString(managerLocaleTag(locale))}/${total.toLocaleString(managerLocaleTag(locale))}` : t("manager.content.notPlanned")}</span><div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${ratio}%` }} /></div></div>;
}

export default function ManagerCampsPage() {
  const { t, locale } = useI18n();
  const { format, count, errorText } = managerContentPresentation(t, locale);
  function personName(person: CampSummary["head_coach"]) { return `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim() || t("manager.content.undefined"); }
  const STATE_LABELS: Record<Exclude<StageState, "all">, string> = { upcoming: t("manager.content.upcoming"), in_progress: t("manager.content.inProgress"), completed: t("manager.content.completed"), draft: t("manager.content.draft"), archived: t("manager.content.archived") };
  function dateRange(camp: CampSummary) {
    const values = camp.days.map((day) => day.starts_at).filter(Boolean).map((value) => new Date(value as string)).sort((a, b) => a.getTime() - b.getTime());
    if (!values.length) return t("manager.content.datesPending");
    const format = new Intl.DateTimeFormat(managerLocaleTag(locale), { timeZone: "Europe/Zurich", day: "2-digit", month: "short", year: "numeric" });
    return values.length === 1 ? format.format(values[0]) : `${format.format(values[0])} – ${format.format(values[values.length - 1])}`;
  }

  const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampSummary[]>([]); const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StageState>("all"); const [periodFilter, setPeriodFilter] = useState("all");
  async function headers(json = false) { const { data } = await supabase.auth.getSession(); return { ...(json ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${data.session?.access_token ?? ""}` }; }
  async function load() { setLoading(true); setError(null); try { const response = await fetch("/api/manager/camps", { headers: await headers(), cache: "no-store" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(payload?.error ?? t("manager.content.loadCampsError"))); setCamps(payload?.camps ?? []); } catch (cause: any) { setError(cause?.message ?? t("manager.content.loadError")); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function archiveCamp(camp: CampSummary) { if (!window.confirm(format("confirmArchive", { name: camp.title }))) return; setBusyId(camp.id); setError(null); setSuccess(null); try { const response = await fetch(`/api/manager/camps/${camp.id}`, { method: "PATCH", headers: await headers(true), body: JSON.stringify({ action: "archive" }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(payload?.error ?? t("manager.content.archiveError"))); setSuccess(t("manager.content.campArchived")); await load(); } catch (cause: any) { setError(cause?.message ?? t("manager.content.archiveError")); } finally { setBusyId(null); } }
  const filtered = useMemo(() => camps.filter((camp) => { const state = campState(camp); if (stateFilter !== "all" && state !== stateFilter) return false; if (!camp.title.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))) return false; if (periodFilter === "all" || !camp.days.length) return true; const first = Math.min(...camp.days.map((day) => day.starts_at ? new Date(day.starts_at).getTime() : Infinity)); const now = new Date(); if (periodFilter === "month") return new Date(first).getMonth() === now.getMonth() && new Date(first).getFullYear() === now.getFullYear(); return new Date(first).getFullYear() === now.getFullYear(); }), [camps, periodFilter, query, stateFilter, locale]);
  const counts = useMemo(() => ({ upcoming: camps.filter((camp) => campState(camp) === "upcoming").length, inProgress: camps.filter((camp) => campState(camp) === "in_progress").length, completed: camps.filter((camp) => campState(camp) === "completed").length, draft: camps.filter((camp) => campState(camp) === "draft").length }), [camps]);
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label={t("manager.content.breadcrumb")}><Link href="/manager">{t("manager.content.manager")}</Link><ChevronRight size={13} /><span>{t("manager.content.camps")}</span></nav>
    <div className={styles.topline}><div><h1>{t("manager.content.camps")}</h1><p className={styles.lead}>{t("manager.content.campsLead")}</p></div><div className={styles.actions}><Link className={styles.primary} href="/manager/camps/new"><Plus size={16} />{t("manager.content.createCamp")}</Link></div></div>
    {error ? <div className={styles.alertError} role="alert">{errorText(error)}</div> : null}{success ? <div className={styles.alertSuccess} role="status">{errorText(success)}</div> : null}
    <section className={styles.stats} aria-label={t("manager.content.campStatistics")}><div className={styles.stat}><span>{t("manager.content.upcoming")}</span><b>{counts.upcoming}</b></div><div className={styles.stat}><span>{t("manager.content.inProgress")}</span><b>{counts.inProgress}</b></div><div className={styles.stat}><span>{t("manager.content.completedPlural")}</span><b>{counts.completed}</b></div><div className={styles.stat}><span>{t("manager.content.drafts")}</span><b>{counts.draft}</b></div></section>
    <section className={styles.panel}><div className={styles.panelHeader}><div><h2>{t("manager.content.campList")}</h2><p>{count("campCount", filtered.length)}</p></div></div>
      <div className={styles.toolbar}><label className={styles.field}><span>{t("manager.content.search")}</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: 13, color: "#7a857b" }} /><input style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("manager.content.campName")} /></span></label><label className={styles.field}><span>{t("manager.content.state")}</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StageState)}><option value="all">{t("manager.content.allStates")}</option><option value="upcoming">{t("manager.content.upcoming")}</option><option value="in_progress">{t("manager.content.inProgress")}</option><option value="completed">{t("manager.content.completedPlural")}</option><option value="draft">{t("manager.content.drafts")}</option><option value="archived">{t("manager.content.archivedPlural")}</option></select></label><label className={styles.field}><span>{t("manager.content.period")}</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">{t("manager.content.allDates")}</option><option value="month">{t("manager.content.thisMonth")}</option><option value="year">{t("manager.content.thisYear")}</option></select></label></div>
      {loading ? <ListLoadingBlock label={t("manager.content.loadingCamps")} /> : filtered.length === 0 ? <div className={styles.empty}>{t("manager.content.noCamps")}</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t("manager.content.camp")}</th><th className={styles.compactHeader}>{t("manager.content.dates")}</th><th className={styles.compactHeader}>{t("manager.content.headCoach")}</th><th className={styles.compactHeader}>{t("manager.content.participants")}</th><th className={styles.compactHeader}>{t("manager.content.capacity")}</th><th>{t("manager.content.state")}</th><th>{t("manager.content.attendance")}</th><th>{t("manager.content.evaluations")}</th><th>{t("manager.content.actions")}</th></tr></thead><tbody>{filtered.map((camp) => {
        const state = campState(camp); const attendanceTotal = camp.days.reduce((sum, day) => sum + Object.values(day.counts ?? {}).reduce((a, b) => a + b, 0), 0); const attendanceDone = camp.days.reduce((sum, day) => sum + Number(day.counts?.present ?? 0) + Number(day.counts?.absent ?? 0) + Number(day.counts?.excused ?? 0), 0); const remaining = camp.capacity == null ? null : camp.capacity - camp.stats.invited; const badgeClass = state === "in_progress" ? styles.badgeProgress : state === "completed" ? styles.badgeDone : state === "archived" ? styles.badgeArchived : state === "draft" ? styles.badgeDraft : "";
        return <tr key={camp.id}><td data-label={t("manager.content.camp")}><div className={styles.titleCell}><b>{camp.title}</b><span className={styles.muted}>{count("dayCount", camp.days.length)}</span></div></td><td data-label={t("manager.content.dates")}>{dateRange(camp)}</td><td data-label={t("manager.content.headCoach")}>{personName(camp.head_coach)}</td><td data-label={t("manager.content.participants")}>{camp.stats.invited}</td><td data-label={t("manager.content.capacity")}>{remaining == null ? t("manager.content.undefinedCapacity") : count("placeCount", Math.max(0, remaining))}</td><td data-label={t("manager.content.state")}><span className={`${styles.badge} ${badgeClass}`}>{STATE_LABELS[state]}</span></td><td data-label={t("manager.content.attendance")}><Progress value={attendanceDone} total={attendanceTotal} /></td><td data-label={t("manager.content.evaluations")}><Progress value={camp.evaluation?.completed ?? 0} total={camp.evaluation?.required ?? 0} /></td><td data-label={t("manager.content.actions")}><div className={styles.actions}><Link className={styles.iconButton} title={t("manager.content.view")} aria-label={format("viewNamed", { name: camp.title })} href={`/manager/camps/${camp.id}`}><Eye size={15} /></Link><Link className={styles.iconButton} title={t("manager.content.edit")} aria-label={format("editNamed", { name: camp.title })} href={`/manager/camps/new?campId=${camp.id}`}><Pencil size={15} /></Link><Link className={styles.iconButton} title={t("manager.content.duplicate")} aria-label={format("duplicateNamed", { name: camp.title })} href={`/manager/camps/new?duplicateId=${camp.id}`}><Copy size={15} /></Link>{state !== "archived" ? <button className={`${styles.iconButton} ${styles.dangerIcon}`} title={t("manager.content.archive")} aria-label={format("archiveNamed", { name: camp.title })} disabled={busyId === camp.id} onClick={() => void archiveCamp(camp)}><Trash2 size={15} /></button> : null}</div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </main>;
}
