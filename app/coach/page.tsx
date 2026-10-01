"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, MapPin, Newspaper, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import CoachLearningCards from "./CoachLearningCards";
import styles from "./CoachDashboard.module.css";
import dashboardStyles from "@/app/player/PlayerDashboard.module.css";
import activityStyles from "./CoachActivityList.module.css";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type EventLite = { id: string; group_id: string; event_type: string; title: string | null; camp_day_index: number | null; starts_at: string; ends_at: string | null; location_text: string | null; status: string };
type CoachNewsLite = { id: string; title: string; image_url: string | null; summary: string | null; body: string; status: "published" | "scheduled" | "archived"; published_at: string | null; scheduled_for: string | null; created_at: string; club_name: string | null };
type HomeData = {
  me: { first_name: string | null; last_name: string | null; avatar_url: string | null } | null;
  organizationNames: string[];
  groupNameById: Record<string, string>;
  clubNameByGroupId: Record<string, string>;
  upcomingEvents: EventLite[];
  pendingEvalEvents: EventLite[];
  groupCount: number;
  playerCount: number;
  pendingAttendanceCount: number;
  pendingEvaluationCount: number;
};

function eventTypeLabel(event: EventLite, t: (key: string) => string) {
  const type = ["training", "interclub", "camp", "session"].includes(event.event_type) ? event.event_type : "other";
  return t(`coach.activity.${type}`);
}

function formatNewsDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(coachDateLocale(locale), { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

function sameDay(iso: string, date: Date) {
  const value = new Date(iso);
  return value.getFullYear() === date.getFullYear() && value.getMonth() === date.getMonth() && value.getDate() === date.getDate();
}

export default function CoachHomePage() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeNews, setActiveNews] = useState<CoachNewsLite[]>([]);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) throw new Error("coach.error.session");
        const [response, newsResponse] = await Promise.all([
          fetch("/api/coach/home", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }),
          fetch(`/api/coach/news?locale=${encodeURIComponent(locale)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }),
        ]);
        if (!response.ok) throw new Error(response.status === 401 ? "coach.error.session" : response.status === 403 ? "coach.error.forbidden" : "coach.error.load");
        const json = await response.json();
        const newsJson = await newsResponse.json().catch(() => ({}));
        if (!active) return;
        setActiveNews(newsResponse.ok && Array.isArray(newsJson.news) ? (newsJson.news as CoachNewsLite[]).filter((item) => item.status === "published") : []);
        setData(json as HomeData);
      } catch (cause) {
        if (active) {
          setData(null);
          setActiveNews([]);
          setError(cause instanceof Error && cause.message.startsWith("coach.error.") ? cause.message : "coach.error.load");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [locale, reload]);

  const today = useMemo(() => (data?.upcomingEvents ?? []).filter((event) => sameDay(event.starts_at, new Date())), [data]);
  const weekEnd = useMemo(() => Date.now() + 7 * 24 * 60 * 60 * 1000, []);
  const thisWeek = useMemo(() => (data?.upcomingEvents ?? []).filter((event) => new Date(event.starts_at).getTime() <= weekEnd), [data, weekEnd]);
  const upcomingPreview = (data?.upcomingEvents ?? []).slice(0, 3);
  const newsPreview = activeNews.slice(0, 2);
  const name = String(data?.me?.first_name ?? "").trim();
  const stats = [
    { label: t("coach.home.today"), value: today.length, icon: CalendarDays },
    { label: t("coach.home.week"), value: thisWeek.length, icon: CalendarDays },
    { label: t("coach.home.attendance"), value: data?.pendingAttendanceCount, icon: CheckCircle2 },
    { label: t("coach.home.evaluations"), value: data?.pendingEvaluationCount, icon: ClipboardCheck },
    { label: t("coach.home.groups"), value: data?.groupCount, icon: Users },
    { label: t("coach.home.players"), value: data?.playerCount, icon: Users },
  ];

  return <div className={styles.page}>
    <nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><span>{t("common.coach")}</span><span aria-hidden="true">/</span><strong>{t("nav.dashboard")}</strong></nav>
    <header className={styles.topline}>
      <div><h1>{`${t("coach.home.hello")}${name ? ` ${name}` : ""}`}</h1><p>{t("coach.home.intro")}</p><div className={styles.context}>{data?.organizationNames?.join(" · ") || (loading ? t("coach.home.contextLoading") : t("coach.home.noClub"))}</div></div>
    </header>
    {error ? <div className={styles.error} role="alert"><AlertTriangle size={17} aria-hidden="true" />{t(error)}<button type="button" onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button></div> : null}
    <div className={styles.homeCards}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>{t("coach.home.upcoming")}</h2><p>{t("coach.home.upcomingHint")}</p></div><Link className={styles.textLink} href="/coach/calendar" aria-label={t("coach.home.openCalendar")}><ArrowRight size={16} /></Link></div>
        <EventList loading={loading} events={upcomingPreview} groups={data?.groupNameById ?? {}} clubs={data?.clubNameByGroupId ?? {}} empty={error ? "—" : t("coach.home.noActivity")} />
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>{t("coach.home.news")}</h2><p>{t("coach.home.newsHint")}</p></div><Link className={styles.textLink} href="/coach/news" aria-label={t("coach.home.allNews")}><ArrowRight size={16} /></Link></div>
        {loading ? <Skeleton /> : newsPreview.length ? <div className={styles.newsPreviewList}>
          {newsPreview.map((item) => <Link key={item.id} className={styles.newsPreviewItem} href="/coach/news">
            {item.image_url ? <span className={styles.newsThumbnail}><img src={item.image_url} alt="" /></span> : <span className={styles.dateBox}><Newspaper size={16} /></span>}
            <span className={styles.newsPreviewContent}><small>{formatNewsDate(item.published_at ?? item.created_at, locale)}</small><b>{item.title}</b><span>{item.club_name || t("coach.activity.noClub")}</span>{item.summary ? <p>{item.summary}</p> : null}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>)}
        </div> : <div className={styles.empty}>{t("coach.home.noNews")}</div>}
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>{t("coach.home.attention")}</h2><p>{t("coach.home.attentionHint")}</p></div></div>
        {loading ? <Skeleton /> : error ? null : <div className={styles.taskList}>
          {(data?.pendingAttendanceCount ?? 0) > 0 ? <Task icon={CheckCircle2} label={coachText(t, data?.pendingAttendanceCount === 1 ? "coach.home.attendanceOne" : "coach.home.attendanceCount", { count: data?.pendingAttendanceCount ?? 0 })} href="/coach/calendar?view=past" /> : null}
          {(data?.pendingEvaluationCount ?? 0) > 0 ? <Task icon={ClipboardCheck} label={coachText(t, data?.pendingEvaluationCount === 1 ? "coach.home.evaluationOne" : "coach.home.evaluationCount", { count: data?.pendingEvaluationCount ?? 0 })} href="/coach/calendar?view=evaluations" tone="warning" /> : null}
          {(data?.pendingAttendanceCount ?? 0) === 0 && (data?.pendingEvaluationCount ?? 0) === 0 ? <div className={styles.empty}><CheckCircle2 size={20} />{t("coach.home.noAttention")}</div> : null}
        </div>}
      </section>
    </div>
    <CoachLearningCards />
    <section className={styles.stats} aria-label={t("coach.home.metrics")}>
      {stats.map(({ label, value, icon: Icon }) => <article className={styles.stat} key={label}><div className={styles.statIcon}><Icon size={17} /></div><span>{label}</span><b>{loading || error || value == null ? "—" : value}</b></article>)}
    </section>
    <section className={styles.shortcuts} aria-label={t("coach.home.shortcuts")}>
      <Link href="/coach/calendar"><CalendarDays size={18} /><span><b>{t("coach.home.openCalendar")}</b><small>{t("coach.home.viewActivities")}</small></span><ArrowRight size={16} /></Link>
      <Link href="/coach/groups"><Users size={18} /><span><b>{t("coach.home.viewGroups")}</b><small>{t("coach.home.groupsHint")}</small></span><ArrowRight size={16} /></Link>
      <Link href="/coach/calendar?view=evaluations"><ClipboardCheck size={18} /><span><b>{t("coach.home.evaluate")}</b><small>{t("coach.home.evaluateHint")}</small></span><ArrowRight size={16} /></Link>
    </section>
  </div>;
}

function EventList({ loading, events, groups, clubs, empty }: { loading: boolean; events: EventLite[]; groups: Record<string, string>; clubs: Record<string, string>; empty: string }) {
  const { locale, t } = useI18n();
  if (loading) return <Skeleton />;
  if (!events.length) return <div className={styles.empty}>{empty}</div>;
  return <div className={`${styles.upcomingList} ${activityStyles.list}`}>{events.map((event) => {
    const start = new Date(event.starts_at);
    const href = `/coach/groups/${event.group_id}/planning/${event.id}`;
    const weekday = new Intl.DateTimeFormat(coachDateLocale(locale), { weekday: "short" }).format(start).replace(".", "");
    const month = new Intl.DateTimeFormat(coachDateLocale(locale), { month: "short" }).format(start).replace(".", "");
    const time = new Intl.DateTimeFormat(coachDateLocale(locale), { hour: "2-digit", minute: "2-digit" }).format(start);
    const explicitTitle = String(event.title ?? "").trim();
    const title = explicitTitle ? `${eventTypeLabel(event, t)} · ${explicitTitle}` : eventTypeLabel(event, t);
    return <article key={event.id} className={`${dashboardStyles.activityItem} ${activityStyles.item}`}>
      <div className={dashboardStyles.activityDate} aria-label={new Intl.DateTimeFormat(coachDateLocale(locale), { dateStyle: "full", timeStyle: "short" }).format(start)}>
        <span>{weekday}</span><b>{start.getDate()}</b><span>{month}</span><time dateTime={event.starts_at}>{time}</time>
      </div>
      <div className={dashboardStyles.activityBody}>
        <Link className={dashboardStyles.activityTitle} href={href}>{title}</Link>
        <span className={dashboardStyles.activityMeta}>{groups[event.group_id] || t("coach.activity.noGroup")} · {clubs[event.group_id] || t("coach.activity.noClub")}</span>
        <span className={`planning-event-location ${dashboardStyles.activityLocation}`}><MapPin size={14} aria-hidden="true"/><span>{event.location_text?.trim() || t("coach.activity.noPlace")}</span></span>
      </div>
      <Link className={activityStyles.action} href={href} aria-label={coachText(t, "coach.openNamed", { name: title })} title={t("coach.open")}><ArrowRight size={15} aria-hidden="true"/></Link>
    </article>;
  })}</div>;
}

function Task({ icon: Icon, label, href, tone }: { icon: typeof CheckCircle2; label: string; href: string; tone?: "warning" }) {
  return <Link href={href} className={tone === "warning" ? styles.taskWarning : ""}><span><Icon size={17} /></span><b>{label}</b><ArrowRight size={15} /></Link>;
}

function Skeleton() { const { t } = useI18n(); return <div className={styles.skeleton} role="status" aria-label={t("common.loading")}><span /><span /><span /></div>; }
