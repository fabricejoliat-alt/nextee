"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, Check, Clock3, Lightbulb, LockKeyhole, Medal, Sparkles, Trophy, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import type { Card, RulesLeaderboard, Series } from "./RulesWorkspace";
import styles from "./PlayerRulesWorkspace.module.css";

type Props = {
  series: Series[];
  current: Series | null;
  cards: Card[];
  read: Set<string>;
  phase: string | null;
  phaseLabel: string;
  leaderboard: RulesLeaderboard | null;
};

function PlayerRulesHero() {
  const { locale } = useI18n();
  return <>
    <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: pickLocaleText(locale, "Règles de golf", "Golf rules") }]} />
    <header className={styles.topline}>
      <div><h1>{pickLocaleText(locale, "Règles de golf", "Golf rules")}</h1><p className={styles.lead}>{pickLocaleText(locale, "Une série à la fois pour mieux jouer, mieux comprendre et gagner en confiance sur le parcours.", "One series at a time to play, understand and feel more confident on the course.")}</p></div>
    </header>
  </>;
}

export function PlayerRulesLoading() {
  const { locale } = useI18n();
  return <main className={styles.page} aria-busy="true"><PlayerRulesHero />
    <section className={styles.cardsSection} aria-labelledby="loading-cards-title"><div className={styles.sectionHeading}><div><h2 id="loading-cards-title">{pickLocaleText(locale, "À découvrir maintenant", "Explore now")}</h2><p>{pickLocaleText(locale, "Les fiches de la série", "This series’ cards")}</p></div></div><div className={styles.cardGrid} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className={styles.loadingCard} key={index}><span className={styles.loadingIcon} /><span className={styles.loadingTitle} /><span className={styles.loadingBadge} /><span className={styles.loadingCardTitle} /><span className={styles.loadingCopy} /></div>)}</div></section>
    <span className={styles.srOnly} role="status">{pickLocaleText(locale, "Chargement des règles…", "Loading rules…")}</span>
  </main>;
}

export default function PlayerRulesWorkspace({ series, current, cards, read, phase, phaseLabel, leaderboard }: Props) {
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

  const title = current?.title_i18n[locale] ?? current?.title_i18n.fr ?? tr("Prochaine série", "Next series");
  const month = (date: string) => new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(date));
  const dateLabel = (date: Date) => new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(date);
  const quizStart = current ? new Date(current.quiz_opens_at) : null;
  const daysUntilQuiz = quizStart ? Math.ceil((quizStart.getTime() - nowMs) / 86_400_000) : 0;
  const quizOpen = phase === "quiz_open";
  const points = (value: number) => new Intl.NumberFormat(locale === "fr" ? "fr-CH" : "en-GB", { maximumFractionDigits: 1 }).format(value);
  const leaderboardMessage = leaderboard?.status === "upcoming"
    ? leaderboard.publishesAt
      ? tr(`Résultats publiés à partir du ${dateLabel(new Date(leaderboard.publishesAt))}.`, `Results published from ${dateLabel(new Date(leaderboard.publishesAt))}.`)
      : tr("Le classement apparaîtra après la publication des résultats du quiz.", "Rankings will appear when quiz results are published.")
    : tr("Le classement est momentanément indisponible.", "Rankings are temporarily unavailable.");

  return <main className={styles.page}>
    <PlayerRulesHero />

    <section className={styles.feature} aria-labelledby="current-series-title">
      <div className={styles.featureCopy}>
        <span className={styles.featureKicker}><Sparkles size={15} />{current ? tr(`Série ${current.position} · ${month(current.discovery_starts_at)}`, `Series ${current.position} · ${month(current.discovery_starts_at)}`) : tr("Bientôt", "Coming soon")}</span>
        <h2 id="current-series-title">{title}</h2>
        <p>{cards.length ? tr("Explore les six situations de la série à ton rythme. Chaque fiche te donne le bon réflexe à adopter sur le terrain.", "Explore six situations at your own pace. Each card gives you a useful on-course reflex.") : tr("Les fiches de cette série seront bientôt disponibles.", "The cards in this series will be available soon.")}</p>
        {quizStart && <div className={styles.featureSchedule}>
          <div className={styles.scheduleItem}><BookOpen size={17} aria-hidden="true" /><span><small>{tr("Période de découverte", "Discovery period")}</small><strong>{tr(`Jusqu’au ${dateLabel(new Date(quizStart.getTime() - 1))} inclus`, `Through ${dateLabel(new Date(quizStart.getTime() - 1))}`)}</strong></span></div>
          <div className={styles.scheduleItem}><CalendarDays size={17} aria-hidden="true" /><span><small>{tr("Quiz officiel", "Official quiz")}</small><strong>{tr(`Dès le ${dateLabel(quizStart)}`, `From ${dateLabel(quizStart)}`)}</strong></span>{daysUntilQuiz > 0 && <em className={styles.scheduleCountdown}>{locale === "fr" ? `J-${daysUntilQuiz}` : `D-${daysUntilQuiz}`}</em>}</div>
          <p className={styles.scheduleNote}>{tr("Les fiches restent consultables après l’ouverture du quiz.", "Cards remain available after the quiz opens.")}</p>
        </div>}
        <div className={styles.featureBottom}><span className={styles.phase}><Clock3 size={15} />{phaseLabel}</span><span>{cards.length} {tr("fiches disponibles", "cards available")}</span>{quizOpen && <Link className={styles.quizLink} href="/player/rules/quiz">{tr("Faire le quiz", "Take the quiz")}<ArrowRight size={16} /></Link>}</div>
      </div>
      <div className={styles.featureArt} aria-hidden="true"><div className={styles.artOrbit}><BookOpen size={62} strokeWidth={1.25} /></div><span className={styles.artChipOne}>01</span><span className={styles.artChipTwo}>06</span><span className={styles.artLine} /></div>
    </section>

    <section className={styles.cardsSection} aria-labelledby="cards-title"><div className={styles.sectionHeading}><div><h2 id="cards-title">{tr("À découvrir maintenant", "Explore now")}</h2><p>{tr("Les fiches de la série", "This series’ cards")}</p></div></div>
      {cards.length ? <div className={styles.cardGrid}>{cards.map(card => <button className={styles.card} key={card.card_version_id} onClick={() => setSelected(card)} type="button">
        <span className={styles.cardLabel}><span className={styles.cardIcon}><BookOpen size={25} strokeWidth={1.6} /></span><span className={styles.cardNumber}>{tr("Fiche", "Card")} {card.position}</span><span className={styles.cardStatus}>{read.has(card.card_version_id) ? <><Check size={12} />{tr("Consultée", "Viewed")}</> : tr("À découvrir", "Discover")}</span></span>
        <span className={styles.cardContent}><small>{card.rules_card_versions.official_reference}</small><span className={styles.cardTitle}>{card.rules_card_versions.title}</span><span>{card.rules_card_versions.situation}</span></span><span className={styles.cardAction}>{tr("Lire la fiche", "Read card")}<ArrowRight size={15} /></span>
      </button>)}</div> : <div className={styles.empty}><LockKeyhole size={25} /><strong>{tr("Fiches en préparation", "Cards being prepared")}</strong><p>{tr("Reviens bientôt pour découvrir cette série.", "Come back soon to explore this series.")}</p></div>}
    </section>

    <section className={styles.calendarSection} aria-labelledby="calendar-title"><div className={styles.sectionHeading}><div><h2 id="calendar-title">{tr("Mon parcours", "My journey")}</h2><p>{tr("Le calendrier des séries", "Series calendar")}</p></div></div><div className={styles.calendarGrid}>{series.map(item => <article key={item.id} className={`${styles.calendarItem} ${item.id === current?.id ? styles.calendarCurrent : ""}`}><span className={styles.calendarNumber}>{String(item.position).padStart(2, "0")}</span><span className={styles.calendarText}><small>{month(item.discovery_starts_at)}</small><strong>{item.title_i18n[locale] ?? item.title_i18n.fr}</strong></span>{item.id === current?.id ? <span className={styles.calendarNow}>{tr("En cours", "Current")}</span> : <CalendarDays size={16} className={styles.calendarIcon} />}</article>)}</div></section>

    {leaderboard && <section className={styles.leaderboardSection} aria-labelledby="leaderboard-title">
      <div className={styles.sectionHeading}><div><h2 id="leaderboard-title">{tr("Classement", "Rankings")}</h2><p>{tr("Les résultats du quiz de la série", "This series’ quiz results")}</p></div></div>
      <div className={styles.leaderboardGrid}>
        <article className={styles.leaderboardCard}><div className={styles.leaderboardHeader}><span className={styles.leaderboardIcon}><Medal size={19} /></span><div><h3>{tr("Dans mon club", "In my club")}</h3><p>{leaderboard.status === "published" ? leaderboard.club.name ?? tr("Mon club", "My club") : tr("Classement des joueurs", "Player ranking")}</p></div></div>
          {leaderboard.status === "published" ? leaderboard.club.rows.length ? <ol className={styles.leaderboardList}>{leaderboard.club.rows.map(row => <li key={row.rank} className={row.isMe ? styles.leaderboardMe : ""}><span className={styles.leaderboardRank}>#{row.rank}</span><strong>{row.isMe ? tr("Vous", "You") : row.name ?? tr(`Joueur ${row.rank}`, `Player ${row.rank}`)}</strong><span className={styles.leaderboardScore}>{points(row.score)} <small>{tr("pts", "pts")}</small></span></li>)}</ol> : <p className={styles.leaderboardEmpty}>{tr("Aucun résultat publié dans votre club pour cette série.", "No published result in your club for this series.")}</p> : <p className={styles.leaderboardEmpty}>{leaderboardMessage}</p>}
        </article>
        <article className={styles.leaderboardCard}><div className={styles.leaderboardHeader}><span className={styles.leaderboardIcon}><Trophy size={19} /></span><div><h3>{tr("Entre les clubs", "Between clubs")}</h3><p>{tr("Moyenne des meilleurs scores · minimum de participants requis", "Average of top scores · minimum participation required")}</p></div></div>
          {leaderboard.status === "published" ? leaderboard.interclub.rows.length ? <ol className={styles.leaderboardList}>{leaderboard.interclub.rows.map(row => <li key={row.clubId} className={row.isMyClub ? styles.leaderboardMe : ""}><span className={styles.leaderboardRank}>{row.rank ? `#${row.rank}` : "—"}</span><strong>{row.name}{row.isMyClub ? ` · ${tr("mon club", "my club")}` : ""}<small>{row.eligible ? tr(`${row.participants} participants`, `${row.participants} participants`) : tr(`${row.participants}/${row.minimum} participants · non classé`, `${row.participants}/${row.minimum} participants · unranked`)}</small></strong><span className={styles.leaderboardScore}>{row.eligible ? <>{points(row.score)} <small>{tr("pts", "pts")}</small></> : "—"}</span></li>)}</ol> : <p className={styles.leaderboardEmpty}>{tr("Aucun club classé pour cette série.", "No club ranked for this series.")}</p> : <p className={styles.leaderboardEmpty}>{leaderboardMessage}</p>}
        </article>
      </div>
    </section>}

    {selected && <div className={styles.backdrop} onMouseDown={() => setSelected(null)}><article className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="player-rule-title" onMouseDown={event => event.stopPropagation()}><button type="button" className={styles.close} onClick={() => setSelected(null)} aria-label={tr("Fermer", "Close")}><X size={20} /></button>
      {selected.rules_card_versions.image_url && <div className={styles.dialogImage}><Image src={selected.rules_card_versions.image_url} alt={selected.rules_card_versions.image_alt || selected.rules_card_versions.title} fill sizes="(max-width: 640px) 100vw, 640px" unoptimized /></div>}
      <div className={styles.dialogBody}><span className={styles.dialogKicker}>{tr(`Fiche ${selected.position}`, `Card ${selected.position}`)} · {selected.rules_card_versions.official_reference}</span><h2 id="player-rule-title">{selected.rules_card_versions.title}</h2><div className={styles.dialogSection}><small>{tr("La situation", "The situation")}</small><p>{selected.rules_card_versions.situation}</p></div><div className={styles.dialogSection}><small>{tr("Comprendre la règle", "Understand the rule")}</small><p>{selected.rules_card_versions.simple_explanation}</p></div><div className={styles.takeaway}><Lightbulb size={20} /><div><strong>{tr("Le bon réflexe", "What to do")}</strong><p>{selected.rules_card_versions.action_text}</p></div></div><div className={styles.dialogSection}><small>{tr("À éviter", "Avoid")}</small><p>{selected.rules_card_versions.common_mistake}</p></div><button className={styles.done} type="button" onClick={() => setSelected(null)}>{tr("Retour aux fiches", "Back to cards")}<ArrowRight size={16} /></button></div>
    </article></div>}
  </main>;
}
