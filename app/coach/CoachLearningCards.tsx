"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, CalendarCheck2, ClipboardCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import styles from "./CoachLearningCards.module.css";

type ValidationPreview = { imageUrl: string | null; imageAlt: string; exerciseCount: number };
type RulesOverview = {
  currentSeriesId: string | null;
  series: Array<{ id: string; position: number; title_i18n: Record<string, string>; discovery_starts_at: string; quiz_opens_at: string; quiz_closes_at: string }>;
  cards: Array<{ card_version_id: string }>;
};

export default function CoachLearningCards() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const [validation, setValidation] = useState<ValidationPreview | null>(null);
  const [rules, setRules] = useState<RulesOverview | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const [validationResult, rulesResult] = await Promise.allSettled([
        fetch("/api/coach/validations", { headers, cache: "no-store" }),
        fetch("/api/rules/overview", { headers, cache: "no-store" }),
      ]);
      if (!active) return;
      if (validationResult.status === "fulfilled" && validationResult.value.ok) {
        const payload = await validationResult.value.json().catch(() => ({})) as { sections?: Array<{ exercises?: Array<{ name: string; illustration_url: string | null }> }> };
        const exercises = payload.sections?.flatMap(section => section.exercises ?? []) ?? [];
        const illustrated = exercises.find(exercise => exercise.illustration_url);
        if (active) setValidation({ imageUrl: illustrated?.illustration_url ?? null, imageAlt: illustrated?.name ?? "", exerciseCount: exercises.length });
      }
      if (rulesResult.status === "fulfilled" && rulesResult.value.ok) {
        const payload = await rulesResult.value.json().catch(() => ({})) as RulesOverview;
        if (active && Array.isArray(payload.series)) setRules(payload);
      }
    })();
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const current = rules?.series.find(series => series.id === rules.currentSeriesId) ?? null;
  const cardCount = current ? rules?.cards.length ?? 0 : 6;
  const quizStart = current ? new Date(current.quiz_opens_at) : null;
  const quizClose = current ? new Date(current.quiz_closes_at) : null;
  const daysUntilQuiz = quizStart ? Math.ceil((quizStart.getTime() - nowMs) / 86_400_000) : 0;
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Zurich" }).format(value);
  const month = current ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(current.discovery_starts_at)) : "";

  return <section className={styles.section} aria-labelledby="coach-learning-title">
    <div className={styles.sectionHeading}><h2 id="coach-learning-title">{tr("Parcours d’apprentissage", "Learning journey")}</h2><p>{tr("Des supports pour faire progresser vos juniors, séance après séance.", "Resources to help your juniors progress, session by session.")}</p></div>
    <div className={styles.grid}>
      <Link href="/coach/validations" className={styles.card}>
        <span className={styles.cardHeader}><span><h3>{tr("Validations", "Validations")}</h3><p>{tr("Un réflexe à garder dans chaque entraînement.", "A habit to keep in every training session.")}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
        <span className={styles.validationVisual}>{validation?.imageUrl ? <Image src={validation.imageUrl} alt={validation.imageAlt} fill sizes="(max-width: 760px) 100vw, 50vw" unoptimized /> : <span className={styles.validationFallback}><ClipboardCheck size={56} strokeWidth={1.45} aria-hidden="true" /></span>}</span>
        <span className={styles.validationBody}><small>{tr("À travailler avec vos juniors", "To work on with your juniors")}</small><strong>{tr("Pensez aux validations", "Keep validations in mind")}</strong><span>{tr("Choisissez un défi adapté à leur niveau, travaillez sa consigne en séance et accompagnez leur progression.", "Choose a challenge suited to their level, practise it in training and support their progress.")}</span>{validation?.exerciseCount ? <em>{validation.exerciseCount} {tr("défis à explorer", "challenges to explore")}</em> : null}</span>
      </Link>
      <Link href="/coach/rules" className={styles.card}>
        <span className={styles.cardHeader}><span><h3>{tr("Règles de golf", "Golf rules")}</h3><p>{tr("Une série à découvrir avec vos juniors.", "A series to explore with your juniors.")}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
        <span className={styles.rulesVisual} aria-hidden="true"><span className={styles.rulesBook}><BookOpen size={42} strokeWidth={1.4} /></span><span className={styles.visualDot}>{String(current?.position ?? 1).padStart(2, "0")}</span><span className={styles.visualDot}>{String(cardCount || 6).padStart(2, "0")}</span></span>
        <span className={styles.rulesBody}>{current ? <><small>{tr(`Série ${current.position} · ${month}`, `Series ${current.position} · ${month}`)}</small><strong>{current.title_i18n[locale] ?? current.title_i18n.fr}</strong></> : <strong>{tr("Les règles du jeu, pas à pas", "The rules of the game, step by step")}</strong>}<span>{tr("Parcourez les situations avec vos juniors et préparez-les au quiz.", "Explore the situations with your juniors and prepare them for the quiz.")}</span></span>
        <span className={styles.milestones}>
          <span className={styles.milestone}><span className={styles.milestoneTop}><span>{tr("Explorer les fiches", "Explore the cards")}</span><BookOpen size={17} aria-hidden="true" /></span><strong>{cardCount} {tr("fiches", "cards")}</strong><small>{quizStart ? tr(`Jusqu’au ${date(new Date(quizStart.getTime() - 1))}`, `Through ${date(new Date(quizStart.getTime() - 1))}`) : tr("À découvrir maintenant", "Available now")}</small></span>
          <span className={`${styles.milestone} ${styles.quizMilestone}`}><span className={styles.milestoneTop}><span>{quizStart && nowMs >= quizStart.getTime() ? tr("Quiz", "Quiz") : tr("Début du quiz dans", "Quiz starts in")}</span><CalendarCheck2 size={17} aria-hidden="true" /></span><strong>{quizStart ? nowMs < quizStart.getTime() ? tr(`${daysUntilQuiz} jours`, `${daysUntilQuiz} days`) : quizClose && nowMs < quizClose.getTime() ? tr("En cours", "Open now") : tr("Terminé", "Closed") : tr("À venir", "Coming soon")}</strong><small>{quizStart ? nowMs < quizStart.getTime() ? date(quizStart) : quizClose && nowMs < quizClose.getTime() ? tr(`Jusqu’au ${date(quizClose)}`, `Until ${date(quizClose)}`) : tr("Résultats à venir", "Results coming soon") : tr("Date à confirmer", "Date to be confirmed")}</small></span>
        </span>
      </Link>
    </div>
  </section>;
}
