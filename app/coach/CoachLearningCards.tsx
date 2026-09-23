"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, ClipboardCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import styles from "./CoachLearningCards.module.css";

type ValidationExercisePreview = {
  id: string;
  name: string;
  illustration_url: string | null;
  challengers?: Array<{ id: string }>;
};
type ValidationHighlight = {
  sectionId: string;
  sectionName: string;
  exerciseId: string;
  exerciseName: string;
  imageUrl: string | null;
  challengerCount: number;
};
type RulesOverview = {
  currentSeriesId: string | null;
  series: Array<{ id: string; position: number; title_i18n: Record<string, string>; discovery_starts_at: string }>;
  cards: Array<{ card_version_id: string }>;
};

export default function CoachLearningCards() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const [validationHighlights, setValidationHighlights] = useState<ValidationHighlight[]>([]);
  const [validationLoading, setValidationLoading] = useState(true);
  const [rules, setRules] = useState<RulesOverview | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (active) setValidationLoading(false);
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const [validationResult, rulesResult] = await Promise.allSettled([
        fetch("/api/coach/validations", { headers, cache: "no-store" }),
        fetch("/api/rules/overview", { headers, cache: "no-store" }),
      ]);
      if (!active) return;
      if (validationResult.status === "fulfilled" && validationResult.value.ok) {
        const payload = await validationResult.value.json().catch(() => ({})) as {
          sections?: Array<{ id: string; name: string; exercises?: ValidationExercisePreview[] }>;
        };
        const highlights = (payload.sections ?? []).slice(0, 4).flatMap((section) => {
          const exercises = section.exercises ?? [];
          const exercise = exercises.find(item => (item.challengers?.length ?? 0) > 0) ?? exercises[0];
          if (!exercise) return [];
          return [{
            sectionId: section.id,
            sectionName: section.name,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            imageUrl: exercise.illustration_url,
            challengerCount: exercise.challengers?.length ?? 0,
          }];
        });
        if (active) setValidationHighlights(highlights);
      }
      if (rulesResult.status === "fulfilled" && rulesResult.value.ok) {
        const payload = await rulesResult.value.json().catch(() => ({})) as RulesOverview;
        if (active && Array.isArray(payload.series)) setRules(payload);
      }
      if (active) setValidationLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const current = rules?.series.find(series => series.id === rules.currentSeriesId) ?? null;
  const cardCount = current ? rules?.cards.length ?? 0 : 6;
  const month = current ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(current.discovery_starts_at)) : "";

  return <section className={styles.section} aria-labelledby="coach-learning-title">
    <div className={styles.sectionHeading}><h2 id="coach-learning-title">{tr("Parcours d’apprentissage", "Learning journey")}</h2><p>{tr("Des supports pour faire progresser vos juniors, séance après séance.", "Resources to help your juniors progress, session by session.")}</p></div>
    <div className={styles.grid}>
      <section className={`${styles.card} ${styles.validationCard}`}>
        <span className={styles.cardHeader}><span><h3>{tr("Validations", "Validations")}</h3><p>{tr("Les prochains défis à travailler par secteur.", "The next challenges to work on by section.")}</p></span><Link href="/coach/validations" aria-label={tr("Toutes les validations", "All validations")}><ArrowRight size={16} aria-hidden="true" /></Link></span>
        {validationLoading ? <span className={styles.validationSkeleton} aria-label={tr("Chargement des validations", "Loading validations")}><i /><i /><i /><i /></span> : validationHighlights.length ? <span className={styles.validationList}>
          {validationHighlights.map(item => <Link href="/coach/validations" className={styles.validationItem} key={item.sectionId}>
            <span className={styles.validationThumbnail}>{item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="92px" unoptimized /> : <ClipboardCheck size={20} aria-hidden="true" />}</span>
            <span className={styles.validationContent}><small>{item.sectionName}</small><b>{item.exerciseName}</b><span>{item.challengerCount} {tr(item.challengerCount > 1 ? "challengers" : "challenger", item.challengerCount > 1 ? "challengers" : "challenger")}</span></span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>)}
        </span> : <Link className={styles.validationEmpty} href="/coach/validations"><ClipboardCheck size={21} aria-hidden="true" /><span>{tr("Consulter le catalogue des validations", "Browse the validation catalogue")}</span><ArrowRight size={16} aria-hidden="true" /></Link>}
      </section>
      <Link href="/coach/rules" className={styles.card}>
        <span className={styles.cardHeader}><span><h3>{tr("Règles de golf", "Golf rules")}</h3><p>{tr("Une série à découvrir avec vos juniors.", "A series to explore with your juniors.")}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
        <span className={styles.rulesVisual} aria-hidden="true"><span className={styles.rulesBook}><BookOpen size={42} strokeWidth={1.4} /></span><span className={styles.visualDot}>{String(current?.position ?? 1).padStart(2, "0")}</span><span className={styles.visualDot}>{String(cardCount || 6).padStart(2, "0")}</span></span>
        <span className={styles.rulesBody}>{current ? <><small>{tr(`Série ${current.position} · ${month}`, `Series ${current.position} · ${month}`)}</small><strong>{current.title_i18n[locale] ?? current.title_i18n.fr}</strong></> : <strong>{tr("Les règles du jeu, pas à pas", "The rules of the game, step by step")}</strong>}<span>{tr("Parcourez les situations avec vos juniors et préparez-les au quiz.", "Explore the situations with your juniors and prepare them for the quiz.")}</span></span>
      </Link>
    </div>
  </section>;
}
