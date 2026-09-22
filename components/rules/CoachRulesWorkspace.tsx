"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, Clock3, Lightbulb, LockKeyhole, RefreshCw, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import type { Card, Series } from "./RulesWorkspace";
import styles from "./CoachRulesWorkspace.module.css";

type Props = {
  series: Series[];
  current: Series | null;
  cards: Card[];
  read: Set<string>;
  phaseLabel: string;
};

function Header({ seriesCount }: { seriesCount?: number }) {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  return <>
    <nav className={styles.breadcrumb} aria-label={tr("Fil d’Ariane", "Breadcrumb")}><Link href="/coach">Coach</Link><ChevronRight size={14} aria-hidden="true" /><span>{tr("Règles de golf", "Golf rules")}</span></nav>
    <header className={styles.topline}>
      <div><h1>{tr("Règles de golf", "Golf rules")}</h1><p>{tr("Accompagnez les juniors dans la découverte des règles, une série à la fois.", "Help juniors discover the rules, one series at a time.")}</p></div>
      <span className={styles.summary}><BookOpen size={18} aria-hidden="true" /><span><b>{seriesCount ?? "—"}</b> {tr(seriesCount === 1 ? "série" : "séries", seriesCount === 1 ? "series" : "series")}</span></span>
    </header>
  </>;
}

export function CoachRulesLoading({ error, onRetry, empty = false }: { error?: string; onRetry?: () => void; empty?: boolean }) {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  return <main className={styles.page} aria-busy={!error && !empty}><Header />
    {error || empty ? <section className={styles.empty} role={error ? "alert" : undefined}><BookOpen size={25} aria-hidden="true" /><strong>{error ? tr("Impossible de charger les règles", "Unable to load the rules") : tr("Aucune saison publiée", "No published season")}</strong><p>{error || tr("Les séries apparaîtront ici dès leur publication.", "Series will appear here once published.")}</p>{error && onRetry ? <button type="button" onClick={onRetry}><RefreshCw size={15} />{tr("Réessayer", "Try again")}</button> : null}</section> : <section className={styles.cardsSection} aria-labelledby="coach-rules-loading-title"><div className={styles.sectionHeading}><h2 id="coach-rules-loading-title">{tr("À découvrir maintenant", "Explore now")}</h2><p>{tr("Les fiches de la série", "This series’ cards")}</p></div><div className={styles.cardGrid} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className={styles.loadingCard} key={index}><span className={styles.loadingIcon} /><span className={styles.loadingTitle} /><span className={styles.loadingBadge} /><span className={styles.loadingCardTitle} /><span className={styles.loadingCopy} /></div>)}</div><span className={styles.srOnly} role="status">{tr("Chargement des règles…", "Loading rules…")}</span></section>}
  </main>;
}

export default function CoachRulesWorkspace({ series, current, cards, read, phaseLabel }: Props) {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const [selected, setSelected] = useState<Card | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const month = (value: string) => new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(value));
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(value);
  const quizStart = current ? new Date(current.quiz_opens_at) : null;
  const daysUntilQuiz = quizStart ? Math.ceil((quizStart.getTime() - nowMs) / 86_400_000) : 0;

  return <main className={styles.page}>
    <Header seriesCount={series.length} />
    <section className={styles.feature} aria-labelledby="coach-current-series-title">
      <div className={styles.featureCopy}>
        <span className={styles.featureKicker}><Sparkles size={15} aria-hidden="true" />{current ? tr(`Série ${current.position} · ${month(current.discovery_starts_at)}`, `Series ${current.position} · ${month(current.discovery_starts_at)}`) : tr("Prochaine série", "Next series")}</span>
        <h2 id="coach-current-series-title">{current?.title_i18n[locale] ?? current?.title_i18n.fr ?? tr("Bientôt disponible", "Coming soon")}</h2>
        <p>{tr("Retrouvez les situations proposées aux juniors et les bons réflexes à expliquer sur le terrain.", "Explore the situations presented to juniors and the right on-course reflexes to explain.")}</p>
        {quizStart ? <div className={styles.schedule}>
          <div><BookOpen size={17} aria-hidden="true" /><span><small>{tr("Découverte des fiches", "Explore the cards")}</small><strong>{tr(`Jusqu’au ${date(new Date(quizStart.getTime() - 1))}`, `Through ${date(new Date(quizStart.getTime() - 1))}`)}</strong></span></div>
          <div><CalendarDays size={17} aria-hidden="true" /><span><small>{tr("Quiz des juniors", "Junior quiz")}</small><strong>{tr(`Dès le ${date(quizStart)}`, `From ${date(quizStart)}`)}</strong></span>{daysUntilQuiz > 0 ? <em>{locale === "fr" ? `J-${daysUntilQuiz}` : `D-${daysUntilQuiz}`}</em> : null}</div>
        </div> : null}
        <div className={styles.featureBottom}><span className={styles.phase}><Clock3 size={15} aria-hidden="true" />{phaseLabel}</span><span>{cards.length} {tr("fiches disponibles", "cards available")}</span></div>
      </div>
      <div className={styles.featureArt} aria-hidden="true"><div className={styles.artOrbit}><BookOpen size={62} strokeWidth={1.25} /></div><span className={styles.artChipOne}>01</span><span className={styles.artChipTwo}>06</span></div>
    </section>

    <section className={styles.cardsSection} aria-labelledby="coach-rules-cards-title"><div className={styles.sectionHeading}><h2 id="coach-rules-cards-title">{tr("À découvrir maintenant", "Explore now")}</h2><p>{tr("Les fiches de la série", "This series’ cards")}</p></div>
      {cards.length ? <div className={styles.cardGrid}>{cards.map(card => <button className={styles.card} key={card.card_version_id} onClick={() => setSelected(card)} type="button">
        <span className={styles.cardLabel}><span className={styles.cardIcon}><BookOpen size={25} strokeWidth={1.6} /></span><span className={styles.cardNumber}>{tr("Fiche", "Card")} {card.position}</span><span className={styles.cardStatus}>{read.has(card.card_version_id) ? <><Check size={12} />{tr("Consultée", "Viewed")}</> : tr("À découvrir", "Discover")}</span></span>
        <span className={styles.cardContent}><small>{card.rules_card_versions.official_reference}</small><strong>{card.rules_card_versions.title}</strong><span>{card.rules_card_versions.situation}</span></span><span className={styles.cardAction}>{tr("Lire la fiche", "Read card")}<ArrowRight size={15} /></span>
      </button>)}</div> : <div className={styles.empty}><LockKeyhole size={25} /><strong>{tr("Fiches en préparation", "Cards being prepared")}</strong><p>{tr("Cette série sera bientôt disponible.", "This series will be available soon.")}</p></div>}
    </section>

    <section className={styles.calendarSection} aria-labelledby="coach-rules-calendar-title"><div className={styles.sectionHeading}><h2 id="coach-rules-calendar-title">{tr("Calendrier des séries", "Series calendar")}</h2><p>{tr("Le parcours de la saison", "The season journey")}</p></div><div className={styles.calendarGrid}>{series.map(item => <article key={item.id} className={`${styles.calendarItem} ${item.id === current?.id ? styles.calendarCurrent : ""}`}><span className={styles.calendarNumber}>{String(item.position).padStart(2, "0")}</span><span className={styles.calendarText}><small>{month(item.discovery_starts_at)}</small><strong>{item.title_i18n[locale] ?? item.title_i18n.fr}</strong></span>{item.id === current?.id ? <span className={styles.calendarNow}>{tr("En cours", "Current")}</span> : <CalendarDays size={16} className={styles.calendarIcon} />}</article>)}</div></section>

    {selected ? <div className={styles.backdrop} onMouseDown={() => setSelected(null)}><article className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="coach-rule-title" onMouseDown={event => event.stopPropagation()}><button type="button" className={styles.close} onClick={() => setSelected(null)} aria-label={tr("Fermer", "Close")}><X size={20} /></button>
      {selected.rules_card_versions.image_url ? <div className={styles.dialogImage}><Image src={selected.rules_card_versions.image_url} alt={selected.rules_card_versions.image_alt || selected.rules_card_versions.title} fill sizes="(max-width: 640px) 100vw, 640px" unoptimized /></div> : null}
      <div className={styles.dialogBody}><span className={styles.dialogKicker}>{tr(`Fiche ${selected.position}`, `Card ${selected.position}`)} · {selected.rules_card_versions.official_reference}</span><h2 id="coach-rule-title">{selected.rules_card_versions.title}</h2><div className={styles.dialogSection}><small>{tr("La situation", "The situation")}</small><p>{selected.rules_card_versions.situation}</p></div><div className={styles.dialogSection}><small>{tr("Comprendre la règle", "Understand the rule")}</small><p>{selected.rules_card_versions.simple_explanation}</p></div><div className={styles.takeaway}><Lightbulb size={20} /><div><strong>{tr("Le bon réflexe", "What to do")}</strong><p>{selected.rules_card_versions.action_text}</p></div></div><div className={styles.dialogSection}><small>{tr("À éviter", "Avoid")}</small><p>{selected.rules_card_versions.common_mistake}</p></div><div className={styles.dialogSection}><small>{tr("Conseil coach", "Coach tip")}</small><p>{selected.rules_card_versions.coach_tip}</p></div><button className={styles.done} type="button" onClick={() => setSelected(null)}>{tr("Retour aux fiches", "Back to cards")}<ArrowRight size={16} /></button></div>
    </article></div> : null}
  </main>;
}
