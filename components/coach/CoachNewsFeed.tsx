"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Eye, Newspaper, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import managerStyles from "@/app/manager/camps/Camps.module.css";
import styles from "./CoachNewsFeed.module.css";

type NewsItem = {
  id: string;
  club_id: string;
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
  linked_group_id: string | null;
  linked_content_label: string | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function displayDate(item: NewsItem) {
  return item.published_at ?? item.scheduled_for ?? item.created_at;
}

function openHref(item: NewsItem) {
  if (item.linked_camp_id) return "/coach/camps";
  if (item.linked_club_event_id && item.linked_group_id) return `/coach/groups/${encodeURIComponent(item.linked_group_id)}/planning/${encodeURIComponent(item.linked_club_event_id)}`;
  if (item.linked_club_event_id) return "/coach/calendar";
  return null;
}

export default function CoachNewsFeed() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      if (!token) throw new Error("Pas de session.");
      const response = await fetch("/api/coach/news", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Impossible de charger les actualités.");
      setNews(Array.isArray(payload.news) ? payload.news as NewsItem[] : []);
    } catch (cause) {
      setNews([]); setError(cause instanceof Error ? cause.message : "Impossible de charger les actualités.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedNews) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedNews(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNews]);

  const activeNews = news.filter((item) => item.status === "published" || item.status === "scheduled");
  const archivedNews = news.filter((item) => item.status === "archived");

  return <main className={managerStyles.page}>
    <nav className={managerStyles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/coach">Coach</Link><ChevronRight size={13} aria-hidden="true"/><span>Actualités</span></nav>
    <header className={managerStyles.topline}><div><h1>Actualités</h1><p className={managerStyles.lead}>Retrouvez les informations partagées avec vos groupes et votre équipe.</p></div></header>
    {error ? <div className={managerStyles.alertError} role="alert"><span>{error}</span><button type="button" className={managerStyles.secondary} onClick={() => void load()}>Réessayer</button></div> : null}
    <section className={styles.activeSection} aria-label="Actualités actives">
      {loading ? <ListLoadingBlock label="Chargement des actualités…" /> : activeNews.length === 0 ? <div className={managerStyles.empty}><Newspaper size={20} aria-hidden="true"/><p>Aucune actualité active pour le moment.</p></div> : <div className={styles.activeList}>{activeNews.map((item) => { const link = openHref(item); return <article className={styles.activeArticle} key={item.id}><div className={styles.articleMeta}><span>{formatDate(displayDate(item))}</span>{item.club_name ? <span>{item.club_name}</span> : null}</div><h3>{item.title}</h3>{item.summary ? <p className={styles.summary}>{item.summary}</p> : null}{item.linked_content_label ? <span className={styles.linkedLabel}>{item.linked_content_label}</span> : null}<div className={styles.body} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(item.body) }}/>{link ? <div className={styles.articleActions}><Link href={link} className={managerStyles.secondary}>Ouvrir l’activité liée</Link></div> : null}</article>; })}</div>}
    </section>
    <section className={managerStyles.panel} aria-labelledby="archived-news-title">
      <div className={managerStyles.panelHeader}><div><h2 id="archived-news-title">Actualités archivées</h2><p>{loading ? "Chargement…" : `${archivedNews.length} actualité${archivedNews.length > 1 ? "s" : ""} archivée${archivedNews.length > 1 ? "s" : ""}.`}</p></div></div>
      {loading ? <ListLoadingBlock label="Chargement des archives…" /> : archivedNews.length === 0 ? <div className={managerStyles.empty}>Aucune actualité archivée.</div> : <div className={managerStyles.tableWrap}><table className={`${managerStyles.table} ${styles.archiveTable}`}><thead><tr><th>Date</th><th>Titre</th><th>Club</th><th>Actions</th></tr></thead><tbody>{archivedNews.map((item) => <tr key={item.id}><td data-label="Date" className={styles.dateCell}>{formatDate(displayDate(item))}</td><td data-label="Titre"><div className={managerStyles.titleCell}><b>{item.title}</b>{item.summary ? <span className={managerStyles.muted}>{item.summary}</span> : null}</div></td><td data-label="Club">{item.club_name || "—"}</td><td data-label="Actions"><div className={managerStyles.actions}><button type="button" className={managerStyles.iconButton} title="Voir le détail" aria-label={`Voir le détail de ${item.title}`} onClick={() => setSelectedNews(item)}><Eye size={15} aria-hidden="true"/></button></div></td></tr>)}</tbody></table></div>}
    </section>
    {selectedNews ? <div className={styles.modalOverlay} role="presentation"><button type="button" className={styles.modalBackdrop} aria-label="Fermer le détail" onClick={() => setSelectedNews(null)}/><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="archived-news-detail-title"><header className={styles.modalHeader}><div><span className={styles.date}>{formatDate(displayDate(selectedNews))}</span><h2 id="archived-news-detail-title">{selectedNews.title}</h2>{selectedNews.summary ? <p>{selectedNews.summary}</p> : null}</div><button type="button" className={managerStyles.iconButton} title="Fermer" aria-label="Fermer" onClick={() => setSelectedNews(null)}><X size={17} aria-hidden="true"/></button></header><div className={styles.modalBody}>{selectedNews.linked_content_label ? <span className={styles.linkedLabel}>{selectedNews.linked_content_label}</span> : null}<div className={styles.body} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(selectedNews.body) }}/></div></section></div> : null}
  </main>;
}
