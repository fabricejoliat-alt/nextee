"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, Clock3, Lightbulb, LockKeyhole, RefreshCw, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import type { Card, Series } from "./RulesWorkspace";
import styles from "./CoachRulesWorkspace.module.css";
import RulesVisual from "./RulesVisual";
import visualStyles from "./RulesVisual.module.css";

type Props = {
  series: Series[];
  current: Series | null;
  cards: Card[];
  read: Set<string>;
  phaseLabel: string;
};

function Header({ seriesCount }: { seriesCount?: number }) {
  const { t } = useI18n();
  return <>
    <nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">Coach</Link><ChevronRight size={14} aria-hidden="true" /><span>{t("coach.rules.title")}</span></nav>
    <header className={styles.topline}>
      <div><h1>{t("coach.rules.title")}</h1><p>{t("coach.rules.intro")}</p></div>
      <span className={styles.summary}><BookOpen size={18} aria-hidden="true" /><span><b>{seriesCount ?? "—"}</b> {t(seriesCount === 1 ? "coach.rules.seriesOne" : "coach.rules.seriesMany")}</span></span>
    </header>
  </>;
}

export function CoachRulesLoading({ error, onRetry, empty = false }: { error?: string; onRetry?: () => void; empty?: boolean }) {
  const { t } = useI18n();
  return <main className={styles.page} aria-busy={!error && !empty}><Header />
    {error || empty ? <section className={styles.empty} role={error ? "alert" : undefined}><BookOpen size={25} aria-hidden="true" /><strong>{error ? t("coach.rules.loadError") : t("coach.rules.noSeason")}</strong><p>{error ? t("coach.rules.loadHint") : t("coach.rules.noSeasonHint")}</p>{error && onRetry ? <button type="button" onClick={onRetry}><RefreshCw size={15} />{t("coach.retry")}</button> : null}</section> : <section className={styles.cardsSection} aria-labelledby="coach-rules-loading-title"><div className={styles.sectionHeading}><h2 id="coach-rules-loading-title">{t("coach.rules.explore")}</h2><p>{t("coach.rules.cardsHint")}</p></div><div className={styles.cardGrid} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className={styles.loadingCard} key={index}><span className={styles.loadingIcon} /><span className={styles.loadingTitle} /><span className={styles.loadingBadge} /><span className={styles.loadingCardTitle} /><span className={styles.loadingCopy} /></div>)}</div><span className={styles.srOnly} role="status">{t("coach.rules.loading")}</span></section>}
  </main>;
}

export default function CoachRulesWorkspace({ series, current, cards, read, phaseLabel }: Props) {
  const { locale, t } = useI18n();
  const [selected, setSelected] = useState<Card | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const month = (value: string) => new Intl.DateTimeFormat(coachDateLocale(locale), { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(value));
  const date = (value: Date) => new Intl.DateTimeFormat(coachDateLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(value);
  const quizStart = current ? new Date(current.quiz_opens_at) : null;
  const daysUntilQuiz = quizStart ? Math.ceil((quizStart.getTime() - nowMs) / 86_400_000) : 0;

  return <main className={styles.page}>
    <Header seriesCount={series.length} />
    <section className={styles.feature} aria-labelledby="coach-current-series-title">
      <div className={styles.featureCopy}>
        <span className={styles.featureKicker}><Sparkles size={15} aria-hidden="true" />{current ? coachText(t, "coach.rules.seriesMonth", { number: current.position, month: month(current.discovery_starts_at) }) : t("coach.rules.nextSeries")}</span>
        <h2 id="coach-current-series-title">{current?.title_i18n[locale] ?? current?.title_i18n.fr ?? t("coach.rules.comingSoon")}</h2>
        <p>{t("coach.rules.featureHint")}</p>
        {quizStart ? <div className={styles.schedule}>
          <div><BookOpen size={17} aria-hidden="true" /><span><small>{t("coach.rules.discovery")}</small><strong>{coachText(t, "coach.rules.through", { date: date(new Date(quizStart.getTime() - 1)) })}</strong></span></div>
          <div><CalendarDays size={17} aria-hidden="true" /><span><small>{t("coach.rules.quiz")}</small><strong>{coachText(t, "coach.rules.from", { date: date(quizStart) })}</strong></span>{daysUntilQuiz > 0 ? <em>{coachText(t, "coach.rules.days", { count: daysUntilQuiz })}</em> : null}</div>
        </div> : null}
        <div className={styles.featureBottom}><span className={styles.phase}><Clock3 size={15} aria-hidden="true" />{phaseLabel}</span><span>{coachText(t, "coach.rules.available", { count: cards.length })}</span></div>
      </div>
      <div className={`${styles.featureArt} ${visualStyles.featureArt}`} aria-hidden="true"><RulesVisual priority /></div>
    </section>

    <section className={styles.cardsSection} aria-labelledby="coach-rules-cards-title"><div className={styles.sectionHeading}><h2 id="coach-rules-cards-title">{t("coach.rules.explore")}</h2><p>{t("coach.rules.cardsHint")}</p></div>
      {cards.length ? <div className={styles.cardGrid}>{cards.map(card => <button className={styles.card} key={card.card_version_id} onClick={() => setSelected(card)} type="button">
        <span className={styles.cardLabel}><span className={styles.cardIcon}><BookOpen size={25} strokeWidth={1.6} /></span><span className={styles.cardNumber}>{t("coach.rules.card")} {card.position}</span><span className={styles.cardStatus}>{read.has(card.card_version_id) ? <><Check size={12} />{t("coach.rules.viewed")}</> : t("coach.rules.discover")}</span></span>
        <span className={styles.cardContent}><small>{card.rules_card_versions.official_reference}</small><strong>{card.rules_card_versions.title}</strong><span>{card.rules_card_versions.situation}</span></span><span className={styles.cardAction}>{t("coach.rules.read")}<ArrowRight size={15} /></span>
      </button>)}</div> : <div className={styles.empty}><LockKeyhole size={25} /><strong>{t("coach.rules.preparing")}</strong><p>{t("coach.rules.preparingHint")}</p></div>}
    </section>

    <section className={styles.calendarSection} aria-labelledby="coach-rules-calendar-title"><div className={styles.sectionHeading}><h2 id="coach-rules-calendar-title">{t("coach.rules.calendar")}</h2><p>{t("coach.rules.seasonJourney")}</p></div><div className={styles.calendarGrid}>{series.map(item => <article key={item.id} className={`${styles.calendarItem} ${item.id === current?.id ? styles.calendarCurrent : ""}`}><span className={styles.calendarNumber}>{String(item.position).padStart(2, "0")}</span><span className={styles.calendarText}><small>{month(item.discovery_starts_at)}</small><strong>{item.title_i18n[locale] ?? item.title_i18n.fr}</strong></span>{item.id === current?.id ? <span className={styles.calendarNow}>{t("coach.rules.current")}</span> : <CalendarDays size={16} className={styles.calendarIcon} />}</article>)}</div></section>

    {selected ? <AccessibleDialog className={styles.dialog} labelledBy="coach-rule-title" onClose={() => setSelected(null)}><button type="button" className={styles.close} onClick={() => setSelected(null)} aria-label={t("common.close")}><X size={20} /></button>
      {selected.rules_card_versions.image_url ? <div className={styles.dialogImage}><Image src={selected.rules_card_versions.image_url} alt={selected.rules_card_versions.image_alt || selected.rules_card_versions.title} fill sizes="(max-width: 640px) 100vw, 640px" unoptimized /></div> : null}
      <div className={styles.dialogBody}><span className={styles.dialogKicker}>{`${t("coach.rules.card")} ${selected.position}`} · {selected.rules_card_versions.official_reference}</span><h2 id="coach-rule-title">{selected.rules_card_versions.title}</h2><div className={styles.dialogSection}><small>{t("coach.rules.situation")}</small><p>{selected.rules_card_versions.situation}</p></div><div className={styles.dialogSection}><small>{t("coach.rules.understand")}</small><p>{selected.rules_card_versions.simple_explanation}</p></div><div className={styles.takeaway}><Lightbulb size={20} /><div><strong>{t("coach.rules.action")}</strong><p>{selected.rules_card_versions.action_text}</p></div></div><div className={styles.dialogSection}><small>{t("coach.rules.avoid")}</small><p>{selected.rules_card_versions.common_mistake}</p></div><div className={styles.dialogSection}><small>{t("coach.rules.tip")}</small><p>{selected.rules_card_versions.coach_tip}</p></div><button className={styles.done} type="button" onClick={() => setSelected(null)}><ArrowLeft size={16} />{t("coach.rules.back")}</button></div>
    </AccessibleDialog> : null}
  </main>;
}
