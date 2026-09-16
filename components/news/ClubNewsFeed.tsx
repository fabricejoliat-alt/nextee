"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Newspaper } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import managerStyles from "@/app/manager/camps/Camps.module.css";
import styles from "./ClubNewsFeed.module.css";

type ClubNewsFeedScope = "player" | "coach";

type NewsItem = {
  id: string;
  club_id: string;
  club_name: string;
  title: string;
  image_url: string | null;
  summary: string | null;
  body: string;
  published_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  linked_club_event_id: string | null;
  linked_camp_id: string | null;
  linked_group_id: string | null;
  linked_content_type: "event" | "camp" | null;
  linked_content_label: string | null;
};

type Props = {
  scope: ClubNewsFeedScope;
  homeHref: string;
  titleFr: string;
  titleEn: string;
  titleDe?: string;
  titleIt?: string;
};

function formatNewsPublishedLabel(iso: string | null, locale: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (locale === "fr") {
    const datePart = new Intl.DateTimeFormat("fr-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
    return `News du ${datePart} à ${String(date.getHours()).padStart(2, "0")}h${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (locale === "de") {
    const datePart = new Intl.DateTimeFormat("de-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
    return `News vom ${datePart} um ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (locale === "it") {
    const datePart = new Intl.DateTimeFormat("it-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
    return `News del ${datePart} alle ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `News from ${datePart} at ${timePart}`;
}

function compactLinkedLabel(label: string | null, contentType: NewsItem["linked_content_type"]) {
  if (!label) return null;
  const parts = label.split(" • ").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return label;

  const monthPattern =
    /(janv|janvier|feb|fev|fevr|fevrier|fév|févr|février|mar|mars|apr|avr|avril|may|mai|jun|juin|jul|juil|juillet|aug|aou|aoû|août|sep|sept|septembre|oct|octobre|nov|novembre|dec|déc|décembre|january|february|march|april|june|july|august|september|october|november|december|januar|februar|marz|märz|april|mai|juni|juli|august|september|oktober|november|dezember|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i;

  const isDateLikeSegment = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(,\s*\d{1,2}:\d{2})?$/.test(normalized)) return true;
    if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}( \d{1,2}:\d{2})?$/.test(normalized)) return true;
    if (monthPattern.test(normalized) && /\d/.test(normalized)) return true;
    if (/\b\d{1,2}:\d{2}\b/.test(normalized) && /\d/.test(normalized)) return true;
    if (/\b20\d{2}\b/.test(normalized) && /\d/.test(normalized)) return true;
    return false;
  };

  while (parts.length > 1 && isDateLikeSegment(parts[parts.length - 1] ?? "")) {
    parts.pop();
  }

  if (contentType === "event") return parts.join(" • ");
  if (contentType === "camp") return parts[0] ?? label;
  return label;
}

export default function ClubNewsFeed({ scope, titleFr, titleEn, titleDe, titleIt }: Props) {
  const { locale } = useI18n();
  const tr = useCallback((fr: string, en: string) => pickLocaleText(locale, fr, en), [locale]);
  const resolveLocaleLabel = (fr: string, en: string, de?: string, it?: string) => {
    if (locale === "fr") return fr;
    if (locale === "de") return de ?? en;
    if (locale === "it") return it ?? en;
    return en;
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [viewerRole, setViewerRole] = useState<"player" | "parent" | "coach">(scope === "coach" ? "coach" : "player");
  const [effectivePlayerId, setEffectivePlayerId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error(tr("Session invalide.", "Invalid session."));

        let url = "";
        if (scope === "player") {
          const ctx = await resolveEffectivePlayerContext();
          if (cancelled) return;
          setViewerRole(ctx.role);
          setEffectivePlayerId(ctx.effectiveUserId);
          const childParam = ctx.role === "parent" && ctx.effectiveUserId ? `?child_id=${encodeURIComponent(ctx.effectiveUserId)}` : "";
          url = `/api/player/news${childParam}`;
        } else {
          url = "/api/coach/news";
        }

        const res = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? tr("Impossible de charger les news.", "Could not load news.")));

        if (cancelled) return;
        setNews(Array.isArray(json?.news) ? (json.news as NewsItem[]) : []);
      } catch (loadError) {
        if (cancelled) return;
        setNews([]);
        setError(loadError instanceof Error ? loadError.message : tr("Impossible de charger les news.", "Could not load news."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [scope, tr]);

  function resolveOpenHref(item: NewsItem) {
    if (item.linked_camp_id) {
      if (scope === "coach") return "/coach/camps";
      const childParam = viewerRole === "parent" && effectivePlayerId ? `?child_id=${encodeURIComponent(effectivePlayerId)}` : "";
      return `/player/camps${childParam}`;
    }

    if (item.linked_club_event_id) {
      if (scope === "coach") {
        if (item.linked_group_id) {
          return `/coach/groups/${encodeURIComponent(item.linked_group_id)}/planning/${encodeURIComponent(item.linked_club_event_id)}`;
        }
        return "/coach/calendar";
      }
      const params = new URLSearchParams({ club_event_id: item.linked_club_event_id });
      if (viewerRole === "parent" && effectivePlayerId) {
        params.set("child_id", effectivePlayerId);
      }
      return `/player/golf/trainings/new?${params.toString()}`;
    }

    return null;
  }

  return (
    <main className={managerStyles.page}>
      <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: resolveLocaleLabel(titleFr, titleEn, titleDe, titleIt) }]} />
      <header className={managerStyles.topline}>
        <div>
          <h1>{resolveLocaleLabel(titleFr, titleEn, titleDe, titleIt)}</h1>
          <p className={managerStyles.lead}>{tr("Retrouvez les informations publiées par votre club.", "Find the latest information published by your club.")}</p>
        </div>
      </header>

      {error ? <div className={managerStyles.alertError} role="alert">{error}</div> : null}

      <section className={styles.newsSection} aria-label={tr("Actualités du club", "Club news")}>
        {loading ? (
          <div className={managerStyles.panel}>
            <ListLoadingBlock label={tr("Chargement des news...", "Loading news...")} />
          </div>
        ) : news.length === 0 ? (
          <div className={managerStyles.panel}>
            <div className={managerStyles.empty}>
              <Newspaper size={22} aria-hidden="true" />
              <p>{tr("Aucune news pour le moment.", "No news yet.")}</p>
            </div>
          </div>
        ) : (
            <div className={styles.newsList}>
              {news.map((item) => {
                const openHref = resolveOpenHref(item);
                const publishedLabel = formatNewsPublishedLabel(item.published_at ?? item.scheduled_for ?? item.created_at, locale);
                const linkedLabel = compactLinkedLabel(item.linked_content_label, item.linked_content_type);

                return (
                  <article
                    key={item.id}
                    className={`${styles.newsArticle} ${item.image_url ? styles.hasImage : ""}`}
                  >
                      {item.image_url ? <div className={styles.coverImage}><img src={item.image_url} alt="" /></div> : null}
                      {publishedLabel ? (
                        <p className={styles.publishedAt}>{publishedLabel}</p>
                      ) : null}

                      {linkedLabel ? (
                        <div className={styles.labels}>
                          <span className={managerStyles.badge}>{linkedLabel}</span>
                        </div>
                      ) : null}

                      <h2>{item.title}</h2>

                      {item.summary ? (
                        <p className={styles.summary}>{item.summary}</p>
                      ) : null}

                      <div
                        className={styles.body}
                        dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(item.body) }}
                      />

                      {openHref ? (
                        <div className={styles.actions}>
                          <Link href={openHref} className={managerStyles.secondary}>
                            <ExternalLink size={15} aria-hidden="true" />
                            {tr("Ouvrir", "Open")}
                          </Link>
                        </div>
                      ) : null}
                  </article>
                );
              })}
            </div>
        )}
      </section>
    </main>
  );
}
