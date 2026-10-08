"use client";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, ClipboardCheck, Flag, ImageIcon, Search, ShieldCheck, Target, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachText } from "@/lib/i18n/coachMessages";
import type { CoachValidationExercise, CoachValidationPlayer, CoachValidationSection } from "@/lib/coachValidations";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import ManagerStatisticsTabs from "@/components/manager/ManagerStatisticsTabs";
import styles from "./CoachValidations.module.css";

type SelectedExercise = CoachValidationExercise & { sectionName: string };

function fullName(player: CoachValidationPlayer, fallback: string) {
  return `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() || fallback;
}
function initials(player: CoachValidationPlayer) {
  return `${player.first_name?.[0] ?? ""}${player.last_name?.[0] ?? ""}`.toUpperCase() || "•";
}

export default function CoachValidationsPage() {
  const { locale, t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<CoachValidationSection[]>([]);
  const [query, setQuery] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("");
  const [selectedExercise, setSelectedExercise] = useState<SelectedExercise | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("coach.error.session");
        const response = await fetch("/api/coach/validations", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 ? "coach.error.session" : response.status === 403 ? "coach.error.forbidden" : "coach.error.load");
        const payload = await response.json();
        if (active) setSections(payload.sections ?? []);
      } catch (cause) {
        if (active) {
          setSections([]);
          setError(cause instanceof Error && cause.message.startsWith("coach.error.") ? cause.message : "coach.error.load");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [reload]);

  useEffect(() => {
    if (!activeSectionId || !sections.some((section) => section.id === activeSectionId)) setActiveSectionId(sections[0]?.id ?? "");
  }, [activeSectionId, sections]);

  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visibleSections = useMemo(() => sections.map((section) => ({
    ...section, exercises: section.exercises.filter((exercise) => !normalizedQuery ||
      [section.name, exercise.name, exercise.objective ?? "", exercise.short_description ?? "", exercise.detailed_description ?? "", exercise.equipment ?? "", exercise.validation_rule_text ?? ""]
        .some((value) => value.toLocaleLowerCase(locale).includes(normalizedQuery))),
  })).filter((section) => section.exercises.length > 0), [locale, normalizedQuery, sections]);
  const totalExercises = sections.reduce((count, section) => count + section.exercises.length, 0);
  const validatedExercises = sections.reduce((count, section) => count + section.exercises.filter((exercise) => exercise.validated_player_count > 0).length, 0);
  // Searching covers the complete catalogue; tabs scope the unfiltered view.
  const displayedSections = !normalizedQuery && activeSectionId ? visibleSections.filter((section) => section.id === activeSectionId) : visibleSections;
  const displayedExercises = displayedSections.reduce((count, section) => count + section.exercises.length, 0);
  const unavailable = loading || Boolean(error);
  const challengeCount = (count: number) => coachText(t, count === 1 ? "coach.validation.challengeOne" : "coach.validation.challengeCount", { count });

  return <div className={styles.page}>
    <nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">{t("common.coach")}</Link><ChevronRight size={14} aria-hidden="true"/><span>{t("coach.nav.validations")}</span></nav>
    <div className={styles.topline}>
      <div><h1>{t("coach.nav.validations")}</h1><p>{t("coach.validation.intro")}</p></div>
      <div className={styles.summary}><ClipboardCheck size={18} aria-hidden="true"/><span>{unavailable ? "—" : challengeCount(totalExercises)}</span></div>
    </div>
    {error ? <div className={styles.errorAlert} role="alert"><div><b>{t("coach.validation.error")}</b><span>{t(error)}</span></div><button type="button" onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button></div> : null}
    <div className={styles.metrics} aria-label={t("coach.validation.summary")} aria-busy={loading}>
      <div><span>{t("coach.validation.available")}</span><strong>{unavailable ? "—" : totalExercises}</strong><small>{t("coach.validation.catalogHint")}</small></div>
      <div><span>{t("coach.validation.validated")}</span><strong>{unavailable ? "—" : validatedExercises}</strong><small>{t("coach.validation.validatedHint")}</small></div>
      <div><span>{t("coach.validation.sections")}</span><strong>{unavailable ? "—" : sections.length}</strong><small>{t("coach.validation.sectionHint")}</small></div>
    </div>
    <section className={styles.catalogPanel} aria-labelledby="validation-catalog-title">
      <div className={styles.panelHeader}><div><h2 id="validation-catalog-title">{t("coach.validation.catalog")}</h2><p>{t("coach.validation.catalogIntro")}</p></div></div>
      <div className={styles.toolbar}>
        <label className={styles.searchField}><Search size={16} aria-hidden="true"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("coach.validation.search")} aria-label={t("coach.validation.search")}/></label>
        <span className={styles.resultCount} role="status">{loading ? t("common.loading") : error ? "—" : challengeCount(displayedExercises)}</span>
      </div>
    </section>
    {sections.length > 0 && !normalizedQuery ? <ManagerStatisticsTabs<string> items={sections.map((section) => ({ value: section.id, label: section.name }))} value={activeSectionId} onChange={setActiveSectionId} ariaLabel={t("coach.validation.sectionNav")} /> : null}
    {loading ? <div className={styles.skeletons} role="status" aria-label={t("common.loading")}><i/><i/><i/></div> : error ? null : displayedSections.length === 0 ?
      <div className={styles.emptyState}><ClipboardCheck size={22} aria-hidden="true"/><strong>{t("coach.validation.empty")}</strong><span>{t("coach.validation.emptyHint")}</span></div> :
      <div className={styles.sectionStack}>{displayedSections.map((section) =>
        <section className={styles.sectionPanel} key={section.id}>
          <header className={styles.sectionHeader}><div><div className={styles.sectionTitleRow}><h2>{section.name}</h2></div><p>{challengeCount(section.exercises.length)}</p></div></header>
          <div className={styles.exerciseList}>{section.exercises.map((exercise) =>
            <article className={styles.exerciseRow} key={exercise.id}>
              <div className={styles.exerciseTop}>
                <span className={styles.sequence}>{exercise.sequence_no}</span>
                <div className={styles.exerciseIdentity}><h3>{exercise.name}</h3><span>{exercise.level != null ? coachText(t, "coach.validation.level", { level: exercise.level }) : t("coach.validation.noLevel")}</span><span>{coachText(t, "coach.validation.playerCount", { validated: exercise.validated_player_count, total: exercise.player_count })}</span></div>
                <button type="button" className={styles.challengerButton} aria-haspopup="dialog" aria-label={coachText(t, "coach.validation.challengersFor", { name: exercise.name })} onClick={() => setSelectedExercise({ ...exercise, sectionName: section.name })}><Users size={15} aria-hidden="true"/>{t("coach.validation.challengers")} ({exercise.challengers.length})</button>
              </div>
              <div className={styles.exerciseContent}>
                {exercise.illustration_url ? <img className={styles.exerciseIllustration} src={exercise.illustration_url} alt={coachText(t, "coach.validation.illustration", { name: exercise.name })}/> : <div className={styles.exerciseIllustrationEmpty}><ImageIcon size={18} aria-hidden="true"/><span>{t("coach.validation.noIllustration")}</span></div>}
                <div className={styles.detailGrid}>
                  {exercise.objective ? <Detail icon={<Target size={14}/>} label={t("coach.validation.objective")} value={exercise.objective}/> : null}
                  {exercise.detailed_description || exercise.short_description ? <Detail icon={<ClipboardCheck size={14}/>} label={t("coach.validation.instructions")} value={exercise.detailed_description || exercise.short_description || ""}/> : null}
                  {exercise.equipment ? <Detail icon={<Flag size={14}/>} label={t("coach.validation.equipment")} value={exercise.equipment}/> : null}
                  {exercise.validation_rule_text ? <Detail icon={<ShieldCheck size={14}/>} label={t("coach.validation.rule")} value={exercise.validation_rule_text}/> : null}
                </div>
              </div>
            </article>)}</div>
        </section>)}</div>}
    {selectedExercise ? <AccessibleDialog className={styles.modal} labelledBy="challengers-title" onClose={() => setSelectedExercise(null)}>
      <header className={styles.modalHeader}>
        <div><span className={styles.modalEyebrow}>{selectedExercise.sectionName} · {selectedExercise.sequence_no}</span><h2 id="challengers-title">{t("coach.validation.challengers")}</h2><p>{selectedExercise.name}</p></div>
        <button type="button" autoFocus className={styles.closeButton} onClick={() => setSelectedExercise(null)} aria-label={t("common.close")}><X size={17} aria-hidden="true"/></button>
      </header>
      <div className={styles.modalBody}>{selectedExercise.challengers.length === 0 ?
        <div className={styles.modalEmpty}><Users size={21} aria-hidden="true"/><strong>{t("coach.validation.noChallenger")}</strong><span>{t("coach.validation.noChallengerHint")}</span></div> :
        <div className={styles.challengerList}>{selectedExercise.challengers.map((player) =>
          <Link className={styles.challengerRow} href={`/coach/players/${player.id}?returnTo=%2Fcoach%2Fvalidations`} key={player.id}>
            {player.avatar_url ? <img src={player.avatar_url} alt=""/> : <span className={styles.avatarFallback}>{initials(player)}</span>}
            <span><b>{fullName(player, t("coach.validation.player"))}</b><small>{t("coach.validation.openPlayer")}</small></span><ChevronRight size={17} aria-hidden="true"/>
          </Link>)}</div>}</div>
    </AccessibleDialog> : null}
  </div>;
}

function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className={styles.detail}><span aria-hidden="true">{icon}</span><div><b>{label}</b><p>{value}</p></div></div>;
}
