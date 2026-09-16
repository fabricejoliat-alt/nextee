"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, Newspaper, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import managerStyles from "@/app/manager/camps/Camps.module.css";
import coachNewsStyles from "@/components/coach/CoachNewsFeed.module.css";
import styles from "./PlayerNewsFeed.module.css";

type NewsItem = {
  id: string;
  club_name: string;
  title: string;
  summary: string | null;
  body: string;
  status: "published" | "scheduled" | "archived";
  published_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  linked_club_event_id: string | null;
  linked_camp_id: string | null;
  linked_content_label: string | null;
};

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";
  return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function displayDate(item: NewsItem) {
  return item.published_at ?? item.scheduled_for ?? item.created_at;
}

export default function PlayerNewsFeed() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [parentChildId, setParentChildId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error(pickLocaleText(locale, "Session invalide.", "Invalid session."));
        const context = await resolveEffectivePlayerContext();
        const childId = context.role === "parent" ? context.effectiveUserId : null;
        const params = new URLSearchParams({ include_archived: "1" });
        if (childId) params.set("child_id", childId);
        const response = await fetch(`/api/player/news?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload.error ?? pickLocaleText(locale, "Impossible de charger les actualités.", "Could not load news.")));
        if (cancelled) return;
        setParentChildId(childId);
        setNews(Array.isArray(payload.news) ? payload.news as NewsItem[] : []);
      } catch (cause) {
        if (cancelled) return;
        setNews([]);
        setError(cause instanceof Error ? cause.message : pickLocaleText(locale, "Impossible de charger les actualités.", "Could not load news."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [locale, reloadKey]);

  useEffect(() => {
    if (!selectedNews) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedNews(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNews]);

  function openHref(item: NewsItem) {
    if (item.linked_camp_id) return `/player/camps${parentChildId ? `?child_id=${encodeURIComponent(parentChildId)}` : ""}`;
    if (item.linked_club_event_id) {
      const params = new URLSearchParams({ club_event_id: item.linked_club_event_id });
      if (parentChildId) params.set("child_id", parentChildId);
      return `/player/golf/trainings/new?${params}`;
    }
    return null;
  }

  const activeNews = news.filter((item) => item.status !== "archived");
  const archivedNews = news.filter((item) => item.status === "archived");

  return <main className={`${managerStyles.page} ${styles.newsPage}`}>
    <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: tr("Actualités", "News") }]} />
    <header className={managerStyles.topline}><div><h1>{tr("Actualités", "News")}</h1><p className={managerStyles.lead}>{tr("Retrouvez les informations publiées par votre club.", "Find the latest information published by your club.")}</p></div></header>
    {error ? <div className={managerStyles.alertError} role="alert"><span>{error}</span><button type="button" className={managerStyles.secondary} onClick={() => setReloadKey((key) => key + 1)}>{tr("Réessayer", "Try again")}</button></div> : null}
    <section className={coachNewsStyles.activeSection} aria-label={tr("Actualités actives", "Active news")}>
      {loading ? <ActiveNewsSkeleton label={tr("Chargement des actualités…", "Loading news…")} /> : activeNews.length === 0 ? <div className={managerStyles.empty}><Newspaper size={20} aria-hidden="true"/><p>{tr("Aucune actualité active pour le moment.", "No active news at the moment.")}</p></div> : <div className={coachNewsStyles.activeList}>{activeNews.map((item) => { const link = openHref(item); return <article className={`${coachNewsStyles.activeArticle} ${styles.activeArticle}`} key={item.id}><div className={coachNewsStyles.articleMeta}><span>{formatDate(displayDate(item), locale)}</span>{item.club_name ? <span className={styles.clubName}>{item.club_name}</span> : null}</div><h3>{item.title}</h3>{item.summary ? <p className={coachNewsStyles.summary}>{item.summary}</p> : null}{item.linked_content_label ? <span className={coachNewsStyles.linkedLabel}>{item.linked_content_label}</span> : null}<div className={coachNewsStyles.body} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(item.body) }}/>{link ? <div className={coachNewsStyles.articleActions}><Link href={link} className={managerStyles.secondary}>{tr("Ouvrir l’activité liée", "Open linked activity")} <ArrowRight size={14} aria-hidden="true"/></Link></div> : null}</article>; })}</div>}
    </section>
    <section className={managerStyles.panel} aria-labelledby="archived-player-news-title">
      <div className={managerStyles.panelHeader}><div><h2 id="archived-player-news-title">{tr("Actualités archivées", "Archived news")}</h2><p>{loading ? <span className={styles.countSkeleton} aria-hidden="true"/> : tr(`${archivedNews.length} actualité${archivedNews.length > 1 ? "s" : ""} archivée${archivedNews.length > 1 ? "s" : ""}.`, `${archivedNews.length} archived news item${archivedNews.length === 1 ? "" : "s"}.`)}</p></div></div>
      {loading ? <ArchivedNewsSkeleton label={tr("Chargement des archives…", "Loading archives…")} /> : archivedNews.length === 0 ? <div className={managerStyles.empty}>{tr("Aucune actualité archivée.", "No archived news.")}</div> : <div className={managerStyles.tableWrap}><table className={`${managerStyles.table} ${coachNewsStyles.archiveTable}`}><thead><tr><th>{tr("Date", "Date")}</th><th>{tr("Titre", "Title")}</th><th>Club</th><th>{tr("Actions", "Actions")}</th></tr></thead><tbody>{archivedNews.map((item) => <tr key={item.id}><td data-label={tr("Date", "Date")} className={coachNewsStyles.dateCell}>{formatDate(displayDate(item), locale)}</td><td data-label={tr("Titre", "Title")}><div className={managerStyles.titleCell}><b>{item.title}</b>{item.summary ? <span className={managerStyles.muted}>{item.summary}</span> : null}</div></td><td data-label="Club">{item.club_name || "—"}</td><td data-label={tr("Actions", "Actions")}><div className={managerStyles.actions}><button type="button" className={managerStyles.iconButton} title={tr("Voir le détail", "View details")} aria-label={tr(`Voir le détail de ${item.title}`, `View details of ${item.title}`)} onClick={() => setSelectedNews(item)}><Eye size={15} aria-hidden="true"/></button></div></td></tr>)}</tbody></table></div>}
    </section>
    {selectedNews ? <div className={coachNewsStyles.modalOverlay} role="presentation"><button type="button" className={coachNewsStyles.modalBackdrop} aria-label={tr("Fermer le détail", "Close details")} onClick={() => setSelectedNews(null)}/><section className={coachNewsStyles.modal} role="dialog" aria-modal="true" aria-labelledby="archived-player-news-detail-title"><header className={coachNewsStyles.modalHeader}><div><span className={coachNewsStyles.date}>{formatDate(displayDate(selectedNews), locale)}</span><h2 id="archived-player-news-detail-title">{selectedNews.title}</h2>{selectedNews.summary ? <p>{selectedNews.summary}</p> : null}</div><button type="button" className={managerStyles.iconButton} title={tr("Fermer", "Close")} aria-label={tr("Fermer", "Close")} onClick={() => setSelectedNews(null)}><X size={17} aria-hidden="true"/></button></header><div className={coachNewsStyles.modalBody}>{selectedNews.linked_content_label ? <span className={coachNewsStyles.linkedLabel}>{selectedNews.linked_content_label}</span> : null}<div className={coachNewsStyles.body} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(selectedNews.body) }}/></div></section></div> : null}
  </main>;
}

function ActiveNewsSkeleton({ label }: { label: string }) {
  return <div className={styles.activeSkeleton} aria-live="polite" aria-busy="true" aria-label={label}><span className={styles.metaSkeleton}/><span className={styles.titleSkeleton}/><span className={styles.bodySkeleton}/><span className={styles.bodySkeletonShort}/></div>;
}

function ArchivedNewsSkeleton({ label }: { label: string }) {
  return <div className={styles.archiveSkeleton} aria-live="polite" aria-busy="true" aria-label={label}><div className={styles.archiveSkeletonHeader}/>{Array.from({ length: 2 }, (_, index) => <div className={styles.archiveSkeletonRow} key={index}><span/><span/><span/><span/></div>)}</div>;
}
