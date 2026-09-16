"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, RefreshCw, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import styles from "./CoachDashboard.module.css";

type EventLite = { id: string; group_id: string; event_type: string; title: string | null; camp_day_index: number | null; starts_at: string; ends_at: string | null; location_text: string | null; status: string };
type CoachNewsLite = { id: string; title: string; summary: string | null; body: string; status: "published" | "scheduled" | "archived"; published_at: string | null; scheduled_for: string | null; created_at: string; club_name: string | null };
type HomeData = {
  me: { first_name: string | null; last_name: string | null; avatar_url: string | null } | null;
  organizationNames: string[];
  groupNameById: Record<string, string>;
  upcomingEvents: EventLite[];
  pendingEvalEvents: EventLite[];
  groupCount: number;
  playerCount: number;
  pendingAttendanceCount: number;
  pendingEvaluationCount: number;
};

function eventLabel(event: EventLite, groups: Record<string, string>) {
  const explicit = String(event.title ?? "").trim();
  if (explicit) return explicit;
  const type = event.event_type === "training" ? "Entraînement" : event.event_type === "camp" ? "Stage / camp" : event.event_type === "session" ? "Séance" : "Activité";
  return `${type} · ${groups[event.group_id] ?? "Groupe"}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function formatNewsDate(iso: string) {
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

function sameDay(iso: string, date: Date) {
  const value = new Date(iso);
  return value.getFullYear() === date.getFullYear() && value.getMonth() === date.getMonth() && value.getDate() === date.getDate();
}

export default function CoachHomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeNews, setActiveNews] = useState<CoachNewsLite[]>([]);

  async function load(background = false) {
    background ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token ?? "";
      const [response, newsResponse] = await Promise.all([
        fetch("/api/coach/home", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/coach/news", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Chargement impossible.");
      const newsJson = await newsResponse.json().catch(() => ({}));
      setActiveNews(newsResponse.ok && Array.isArray(newsJson.news) ? (newsJson.news as CoachNewsLite[]).filter((item) => item.status === "published" || item.status === "scheduled") : []);
      setData(json as HomeData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const today = useMemo(() => (data?.upcomingEvents ?? []).filter((event) => sameDay(event.starts_at, new Date())), [data]);
  const weekEnd = useMemo(() => Date.now() + 7 * 24 * 60 * 60 * 1000, []);
  const thisWeek = useMemo(() => (data?.upcomingEvents ?? []).filter((event) => new Date(event.starts_at).getTime() <= weekEnd), [data, weekEnd]);
  const name = String(data?.me?.first_name ?? "").trim();
  const stats = [
    { label: "Activités aujourd’hui", value: today.length, icon: CalendarDays },
    { label: "À venir cette semaine", value: thisWeek.length, icon: CalendarDays },
    { label: "Présences à compléter", value: data?.pendingAttendanceCount, icon: CheckCircle2 },
    { label: "Évaluations à terminer", value: data?.pendingEvaluationCount, icon: ClipboardCheck },
    { label: "Groupes suivis", value: data?.groupCount, icon: Users },
    { label: "Juniors suivis", value: data?.playerCount, icon: Users },
  ];

  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><span>Coach</span><span aria-hidden="true">/</span><strong>Tableau de bord</strong></nav>
    <header className={styles.topline}>
      <div><h1>{name ? `Bonjour ${name}` : "Bonjour"}</h1><p>Votre centre d’action pour les activités, présences et évaluations.</p><div className={styles.context}>{data?.organizationNames?.join(" · ") || (loading ? "Chargement du contexte…" : "Aucun club actif")}</div></div>
      <button className={styles.secondary} type="button" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? styles.spin : ""} />Actualiser</button>
    </header>
    {error ? <div className={styles.error}><AlertTriangle size={17} />{error}<button type="button" onClick={() => void load()}>Réessayer</button></div> : null}
    {!loading && activeNews.length > 0 ? <section className={styles.featuredNews} aria-label="Actualités"><div className={styles.newsList}>{activeNews.map((item) => <article key={item.id} className={styles.newsItem}><div className={styles.newsMeta}><span>{formatNewsDate(item.published_at ?? item.scheduled_for ?? item.created_at)}</span>{item.club_name ? <span>{item.club_name}</span> : null}</div><h2>{item.title}</h2>{item.summary ? <p className={styles.newsSummary}>{item.summary}</p> : null}<div className={styles.newsBody} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(item.body) }}/></article>)}</div><div className={styles.newsFooter}><Link className={styles.actionButton} href="/coach/news">Voir toutes les actualités <ArrowRight size={14} /></Link></div></section> : null}
    <section className={styles.stats} aria-label="Indicateurs principaux">
      {stats.map(({ label, value, icon: Icon }) => <article className={styles.stat} key={label}><div className={styles.statIcon}><Icon size={17} /></div><span>{label}</span><b>{loading || value == null ? "—" : value}</b></article>)}
    </section>
    <div className={styles.columns}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Aujourd’hui</h2><p>Les activités prévues aujourd’hui.</p></div><span className={styles.badge}>{today.length}</span></div>
        <EventList loading={loading} events={today} groups={data?.groupNameById ?? {}} empty="Aucune activité prévue aujourd’hui." />
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>À faire</h2><p>Les actions qui nécessitent votre attention.</p></div></div>
        {loading ? <Skeleton /> : <div className={styles.taskList}>
          {(data?.pendingAttendanceCount ?? 0) > 0 ? <Task icon={CheckCircle2} label={`${data?.pendingAttendanceCount} présence(s) à compléter`} href="/coach/calendar?view=past" /> : null}
          {(data?.pendingEvaluationCount ?? 0) > 0 ? <Task icon={ClipboardCheck} label={`${data?.pendingEvaluationCount} évaluation(s) à terminer`} href="/coach/calendar?view=evaluations" tone="warning" /> : null}
          {(data?.pendingAttendanceCount ?? 0) === 0 && (data?.pendingEvaluationCount ?? 0) === 0 ? <div className={styles.empty}><CheckCircle2 size={20} />Aucune action urgente.</div> : null}
        </div>}
      </section>
    </div>
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>Cette semaine</h2><p>Vos prochaines activités et leur contexte.</p></div><Link className={styles.actionButton} href="/coach/calendar">Voir le calendrier <ArrowRight size={14} /></Link></div>
      <EventList loading={loading} events={thisWeek} groups={data?.groupNameById ?? {}} empty="Aucune activité prévue cette semaine." />
    </section>
    <section className={styles.shortcuts} aria-label="Raccourcis">
      <Link href="/coach/calendar"><CalendarDays size={18} /><span><b>Ouvrir le calendrier</b><small>Consulter vos activités</small></span><ArrowRight size={16} /></Link>
      <Link href="/coach/groups"><Users size={18} /><span><b>Consulter mes groupes</b><small>Juniors et planning</small></span><ArrowRight size={16} /></Link>
      <Link href="/coach/calendar?view=evaluations"><ClipboardCheck size={18} /><span><b>Évaluations à faire</b><small>Compléter les retours attendus</small></span><ArrowRight size={16} /></Link>
    </section>
  </div>;
}

function EventList({ loading, events, groups, empty }: { loading: boolean; events: EventLite[]; groups: Record<string, string>; empty: string }) {
  if (loading) return <Skeleton />;
  if (!events.length) return <div className={styles.empty}>{empty}</div>;
  return <div className={styles.eventList}>{events.map((event) => <Link key={event.id} href={`/coach/groups/${event.group_id}/planning/${event.id}`}><div className={styles.dateBox}><CalendarDays size={16} /></div><div><b>{eventLabel(event, groups)}</b><span>{formatDate(event.starts_at)} · {event.location_text || "Lieu non renseigné"}</span></div><ArrowRight size={16} /></Link>)}</div>;
}

function Task({ icon: Icon, label, href, tone }: { icon: typeof CheckCircle2; label: string; href: string; tone?: "warning" }) {
  return <Link href={href} className={tone === "warning" ? styles.taskWarning : ""}><span><Icon size={17} /></span><b>{label}</b><ArrowRight size={15} /></Link>;
}

function Skeleton() { return <div className={styles.skeleton} aria-label="Chargement"><span /><span /><span /></div>; }
