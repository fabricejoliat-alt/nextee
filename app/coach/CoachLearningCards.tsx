"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachText, coachDateLocale } from "@/lib/i18n/coachMessages";
import { etiquetteText } from "@/lib/etiquetteLabels";
import EtiquetteVisual from "@/components/etiquette/EtiquetteVisual";
import etiquetteVisualStyles from "@/components/etiquette/EtiquetteVisual.module.css";
import RulesVisual from "@/components/rules/RulesVisual";
import rulesVisualStyles from "@/components/rules/RulesVisual.module.css";
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
  const { locale, t } = useI18n();
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
  const month = current ? new Intl.DateTimeFormat(coachDateLocale(locale), { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(current.discovery_starts_at)) : "";
  const etiquette = etiquetteText(locale);

  return <section className={styles.section} aria-labelledby="coach-learning-title">
    <div className={styles.sectionHeading}><h2 id="coach-learning-title">{t("coach.learning.title")}</h2><p>{t("coach.learning.intro")}</p></div>
    <div className={styles.grid}>
      <section className={`${styles.card} ${styles.validationCard}`}>
        <span className={styles.cardHeader}><span><h3>{t("coach.nav.validations")}</h3><p>{t("coach.learning.challenges")}</p></span><Link href="/coach/validations" aria-label={t("coach.learning.allValidations")}><ArrowRight size={16} aria-hidden="true" /></Link></span>
        {validationLoading ? <span className={styles.validationSkeleton} aria-label={t("coach.learning.loading")}><i /><i /><i /><i /></span> : validationHighlights.length ? <span className={styles.validationList}>
          {validationHighlights.map(item => <Link href="/coach/validations" className={styles.validationItem} key={item.sectionId}>
            <span className={styles.validationThumbnail}>{item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="92px" unoptimized /> : <ClipboardCheck size={20} aria-hidden="true" />}</span>
            <span className={styles.validationContent}><small>{item.sectionName}</small><b>{item.exerciseName}</b><span>{item.challengerCount} {t("coach.validation.challengers")}</span></span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>)}
        </span> : <Link className={styles.validationEmpty} href="/coach/validations"><ClipboardCheck size={21} aria-hidden="true" /><span>{t("coach.learning.catalog")}</span><ArrowRight size={16} aria-hidden="true" /></Link>}
      </section>
      <Link href="/coach/rules" className={styles.card}>
        <span className={styles.cardHeader}><span><h3>{t("coach.nav.rules")}</h3><p>{t("coach.learning.rulesIntro")}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
        <span className={`${styles.rulesVisual} ${rulesVisualStyles.visual}`} aria-hidden="true"><RulesVisual /></span>
        <span className={styles.rulesBody}>{current ? <><small>{coachText(t, "coach.learning.series", { number: current.position, month })}</small><strong>{current.title_i18n[locale] ?? current.title_i18n.fr}</strong></> : <strong>{t("coach.learning.rulesTitle")}</strong>}<span>{t("coach.learning.rulesHint")}</span></span>
      </Link>
      <Link href="/coach/etiquette" className={styles.card}>
        <span className={styles.cardHeader}><span><h3>{etiquette.title}</h3><p>{etiquette.intro}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
        <span className={`${etiquetteVisualStyles.visual} ${styles.etiquetteVisual}`}><EtiquetteVisual /></span>
        <span className={styles.rulesBody}><small>{etiquette.explore}</small><strong>{etiquette.path}</strong><span>{etiquette.cards}</span></span>
      </Link>
    </div>
  </section>;
}
