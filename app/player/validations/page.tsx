"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Clock3, Flag, Lock, ShieldCheck, Target, Trash2, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import type { ValidationDashboardPayload, ValidationExerciseItem } from "@/lib/validations";
import styles from "./PlayerValidations.module.css";

function labelByLocale(locale: string, fr: string, en: string) {
  return locale === "fr" ? fr : en;
}

function progressRatio(value: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
}

function toDateLocalValue(value: Date) {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatAttemptDate(locale: string, value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", {
    timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(parsed);
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  return <div className={styles.progress} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={total || 1}>
    <span style={{ width: `${progressRatio(value, total)}%` }} />
  </div>;
}

function ValidationsPageSkeleton() {
  return <div className={styles.skeleton} aria-hidden="true">
    <div className={styles.skeletonSummary} />
    <div className={styles.skeletonTabs} />
    <div className={styles.skeletonGrid}>{[0, 1, 2].map((item) => <div key={item} className={styles.skeletonCard} />)}</div>
  </div>;
}

export default function PlayerValidationsPage() {
  const { locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");
  const [deletingAttemptId, setDeletingAttemptId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ValidationDashboardPayload | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [attemptDateDrafts, setAttemptDateDrafts] = useState<Record<string, string>>({});
  const [expandedExerciseIds, setExpandedExerciseIds] = useState<Record<string, boolean>>({});

  const txt = useMemo(() => ({
    title: labelByLocale(locale, "Validations", "Validations"),
    subtitle: labelByLocale(locale, "Progresse secteur par secteur, à ton rythme.", "Progress through each section at your own pace."),
    loading: labelByLocale(locale, "Chargement des validations…", "Loading validations…"),
    overall: labelByLocale(locale, "Progression globale", "Overall progress"),
    completed: labelByLocale(locale, "validations réussies", "validations completed"),
    sections: labelByLocale(locale, "Secteurs", "Sections"),
    sectionProgress: labelByLocale(locale, "validations réussies", "validations completed"),
    objective: labelByLocale(locale, "Objectif", "Goal"),
    instruction: labelByLocale(locale, "Consigne", "Instruction"),
    equipment: labelByLocale(locale, "Matériel", "Equipment"),
    validation: labelByLocale(locale, "Validation", "Validation"),
    note: labelByLocale(locale, "Score / note", "Score / note"),
    success: labelByLocale(locale, "Réussi", "Success"),
    failure: labelByLocale(locale, "Manqué", "Missed"),
    locked: labelByLocale(locale, "Verrouillé", "Locked"),
    inProgress: labelByLocale(locale, "En cours", "In progress"),
    toDo: labelByLocale(locale, "À faire", "To do"),
    validated: labelByLocale(locale, "Validé", "Validated"),
    history: labelByLocale(locale, "Historique des essais", "Attempt history"),
    noHistory: labelByLocale(locale, "Aucun essai enregistré.", "No attempts recorded."),
    level: labelByLocale(locale, "Niveau", "Level"),
    dateTime: labelByLocale(locale, "Date", "Date"),
    recordDisabled: labelByLocale(locale, "Consultation seule pour ce profil.", "Read-only access for this profile."),
    saved: labelByLocale(locale, "Essai enregistré.", "Attempt saved."),
    deleted: labelByLocale(locale, "Tentative supprimée.", "Attempt deleted."),
    deleteAttempt: labelByLocale(locale, "Supprimer", "Delete"),
    deleteAttemptConfirm: labelByLocale(locale,
      "Supprimer cette tentative ? Si c'était la dernière réussite de cet exercice, les défis suivants seront à nouveau verrouillés.",
      "Delete this attempt? If it was the last successful attempt for this exercise, the following challenges will be locked again."),
    start: labelByLocale(locale, "Commencer", "Start"),
    continue: labelByLocale(locale, "Continuer", "Continue"),
    view: labelByLocale(locale, "Voir la validation", "View validation"),
    close: labelByLocale(locale, "Réduire", "Collapse"),
    imageMissing: labelByLocale(locale, "Illustration indisponible", "Illustration unavailable"),
    nextUnlock: labelByLocale(locale, "Valide le défi précédent pour débloquer celui-ci.", "Complete the previous challenge to unlock this one."),
  }), [locale]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Pas de session.");
        const ctx = await resolveEffectivePlayerContext();
        const qs = ctx.role === "parent" && ctx.effectiveUserId ? `?child_id=${encodeURIComponent(ctx.effectiveUserId)}` : "";
        const res = await fetch(`/api/player/validations${qs}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Erreur de chargement.");
        if (!active) return;
        const payload = json as ValidationDashboardPayload;
        setDashboard(payload);
        setSelectedSectionId((current) => current || payload.sections[0]?.id || "");
      } catch (err: unknown) {
        if (!active) return;
        setDashboard(null);
        setError(err instanceof Error ? err.message : "Erreur de chargement.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const selectedSection = useMemo(
    () => dashboard?.sections.find((section) => section.id === selectedSectionId) ?? dashboard?.sections[0] ?? null,
    [dashboard, selectedSectionId]
  );

  function toggleExercise(exercise: ValidationExerciseItem) {
    if (!exercise.is_unlocked) return;
    setExpandedExerciseIds((current) => ({ ...current, [exercise.id]: !current[exercise.id] }));
    setAttemptDateDrafts((current) => current[exercise.id] ? current : { ...current, [exercise.id]: toDateLocalValue(new Date()) });
  }

  async function saveAttempt(exercise: ValidationExerciseItem, result: "success" | "failure") {
    if (!dashboard?.can_record_attempts) return;
    setSubmittingId(exercise.id);
    setError(null);
    setInfo(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session.");
      const ctx = await resolveEffectivePlayerContext();
      const res = await fetch("/api/player/validations/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          child_id: ctx.role === "parent" ? ctx.effectiveUserId : "",
          exercise_id: exercise.id,
          result,
          note: noteDrafts[exercise.id] ?? "",
          attempted_at: attemptDateDrafts[exercise.id] ?? "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Erreur d'enregistrement.");
      setDashboard(json.dashboard as ValidationDashboardPayload);
      if (result === "success") setExpandedExerciseIds((current) => ({ ...current, [exercise.id]: false }));
      setInfo(txt.saved);
      setNoteDrafts((current) => ({ ...current, [exercise.id]: "" }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur d'enregistrement.");
    } finally {
      setSubmittingId("");
    }
  }

  async function deleteAttempt(attemptId: string) {
    if (!dashboard?.can_record_attempts || !attemptId) return;
    if (!window.confirm(txt.deleteAttemptConfirm)) return;
    setDeletingAttemptId(attemptId);
    setError(null);
    setInfo(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session.");
      const ctx = await resolveEffectivePlayerContext();
      const qs = ctx.role === "parent" && ctx.effectiveUserId ? `?child_id=${encodeURIComponent(ctx.effectiveUserId)}` : "";
      const res = await fetch(`/api/player/validations/attempts/${encodeURIComponent(attemptId)}${qs}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Erreur de suppression.");
      setDashboard(json.dashboard as ValidationDashboardPayload);
      setInfo(txt.deleted);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur de suppression.");
    } finally {
      setDeletingAttemptId("");
    }
  }

  return <div className="player-dashboard-bg">
    <div className="app-shell marketplace-page">
      <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: txt.title }]} />
      <section className="glass-section">
        <div className="marketplace-header">
          <div>
            <h1 className="section-title">{txt.title}</h1>
            <p className="section-subtitle">{txt.subtitle}</p>
          </div>
        </div>
      </section>

      {error ? <div className="marketplace-error" role="alert">{error}</div> : null}
      {info ? <div className={styles.notice} role="status"><CheckCircle2 size={17} aria-hidden="true" />{info}</div> : null}

      {loading ? <ValidationsPageSkeleton /> : dashboard ? <div className={styles.content}>
        <div className={styles.summary}>
          <div className={styles.summaryTop}>
            <div>
              <span className={styles.eyebrow}>{txt.overall}</span>
              <div className={styles.summaryValue}>{dashboard.overall_validated_count}<span> / {dashboard.overall_total_count}</span></div>
            </div>
            <span className={styles.summaryCaption}>{txt.completed}</span>
          </div>
          <ProgressBar value={dashboard.overall_validated_count} total={dashboard.overall_total_count} />
        </div>

        <nav className={styles.sectorNav} aria-label={txt.sections}>
          {dashboard.sections.map((section) => <button
            key={section.id} type="button"
            className={`${styles.sectorTab} ${selectedSection?.id === section.id ? styles.sectorTabActive : ""}`}
            onClick={() => setSelectedSectionId(section.id)}
            aria-current={selectedSection?.id === section.id ? "true" : undefined}
          >
            <span>{section.name}</span><small>{section.validated_count}/{section.total_count}</small>
          </button>)}
        </nav>

        {selectedSection ? <section className={styles.sectorSection} aria-labelledby="validation-sector-title">
          <div className={styles.sectorHeading}>
            <div className={styles.sectorTitleLine}>
              <span className={styles.sectorIcon}><Flag size={18} strokeWidth={1.8} aria-hidden="true" /></span>
              <div>
                <h2 id="validation-sector-title">{selectedSection.name}</h2>
                <p>{selectedSection.validated_count} / {selectedSection.total_count} {txt.sectionProgress}</p>
              </div>
            </div>
            <div className={styles.sectorProgress}><ProgressBar value={selectedSection.validated_count} total={selectedSection.total_count} /></div>
          </div>

          <div className={styles.exerciseGrid}>
            {selectedSection.exercises.map((exercise) => {
              const expanded = Boolean(expandedExerciseIds[exercise.id]);
              const status = exercise.is_validated ? txt.validated : !exercise.is_unlocked ? txt.locked : exercise.attempts.length ? txt.inProgress : txt.toDo;
              const StatusIcon = exercise.is_validated ? CheckCircle2 : !exercise.is_unlocked ? Lock : exercise.attempts.length ? Clock3 : Target;
              const action = exercise.is_validated ? txt.view : exercise.attempts.length ? txt.continue : txt.start;
              return <article key={exercise.id} className={`${styles.exerciseCard} ${expanded ? styles.exerciseCardExpanded : ""}`}>
                <div className={styles.imageFrame}>
                  {exercise.illustration_url ? <Image src={exercise.illustration_url} alt={exercise.name} fill sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 33vw" unoptimized />
                    : <span className={styles.imageFallback}><ClipboardList size={24} strokeWidth={1.6} aria-hidden="true" /><span>{txt.imageMissing}</span></span>}
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.cardMeta}>
                    <span className={`${styles.status} ${exercise.is_validated ? styles.statusDone : !exercise.is_unlocked ? styles.statusLocked : exercise.attempts.length ? styles.statusProgress : styles.statusTodo}`}>
                      <StatusIcon size={14} strokeWidth={2} aria-hidden="true" />{status}
                    </span>
                    <span className={styles.sequence}>{exercise.level != null ? `${txt.level} ${exercise.level}` : `${exercise.sequence_no}`}</span>
                  </div>
                  <h3>{exercise.name}</h3>
                  {exercise.short_description || exercise.objective ? <p className={styles.cardDescription}>{exercise.short_description || exercise.objective}</p> : null}
                  {exercise.is_unlocked ? <button type="button" className={`btn ${exercise.is_validated ? "" : "btn-primary"} ${styles.cardAction}`}
                    onClick={() => toggleExercise(exercise)} aria-expanded={expanded} aria-controls={`validation-detail-${exercise.id}`}>
                    {expanded ? txt.close : action}{expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                  </button> : <p className={styles.lockedHint}>{txt.nextUnlock}</p>}
                </div>

                {expanded && exercise.is_unlocked ? <div id={`validation-detail-${exercise.id}`} className={styles.detail}>
                  <div className={styles.detailFacts}>
                    {exercise.objective ? <DetailFact icon={<Target size={15} />} label={txt.objective} value={exercise.objective} /> : null}
                    {exercise.detailed_description || exercise.short_description ? <DetailFact icon={<ClipboardList size={15} />} label={txt.instruction} value={exercise.detailed_description || exercise.short_description || ""} /> : null}
                    {exercise.equipment ? <DetailFact icon={<Flag size={15} />} label={txt.equipment} value={exercise.equipment} /> : null}
                    {exercise.validation_rule_text ? <DetailFact icon={<ShieldCheck size={15} />} label={txt.validation} value={exercise.validation_rule_text} /> : null}
                  </div>

                  <div className={styles.attemptForm}>
                    <div className={styles.formFields}>
                      <label><span>{txt.dateTime}</span><input type="date" value={attemptDateDrafts[exercise.id] ?? ""}
                        onChange={(event) => setAttemptDateDrafts((current) => ({ ...current, [exercise.id]: event.target.value }))}
                        disabled={!dashboard.can_record_attempts || submittingId === exercise.id} /></label>
                      <label><span>{txt.note}</span><textarea rows={2} value={noteDrafts[exercise.id] ?? ""}
                        onChange={(event) => setNoteDrafts((current) => ({ ...current, [exercise.id]: event.target.value }))}
                        disabled={!dashboard.can_record_attempts || submittingId === exercise.id} /></label>
                    </div>
                    <div className={styles.formActions}>
                      <button type="button" className="btn btn-primary" disabled={!dashboard.can_record_attempts || submittingId === exercise.id}
                        onClick={() => saveAttempt(exercise, "success")}><CheckCircle2 size={16} aria-hidden="true" />{submittingId === exercise.id ? txt.loading : txt.success}</button>
                      <button type="button" className="btn" disabled={!dashboard.can_record_attempts || submittingId === exercise.id}
                        onClick={() => saveAttempt(exercise, "failure")}><XCircle size={16} aria-hidden="true" />{txt.failure}</button>
                    </div>
                    {!dashboard.can_record_attempts ? <p className={styles.readOnly}>{txt.recordDisabled}</p> : null}
                  </div>

                  <div className={styles.history}>
                    <h4>{txt.history}</h4>
                    {exercise.attempts.length === 0 ? <p>{txt.noHistory}</p> : <div className={styles.historyList}>
                      {exercise.attempts.map((attempt) => <div key={attempt.id} className={styles.historyItem}>
                        <span className={`${styles.attemptResult} ${attempt.result === "success" ? styles.attemptSuccess : styles.attemptFailure}`}>
                          {attempt.result === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
                          {attempt.result === "success" ? txt.success : txt.failure}
                        </span>
                        {attempt.note ? <span className={styles.attemptNote}>{attempt.note}</span> : null}
                        <time dateTime={attempt.attempted_at}><Clock3 size={14} aria-hidden="true" />{formatAttemptDate(locale, attempt.attempted_at)}</time>
                        {dashboard.can_record_attempts ? <button type="button" className={`btn btn-danger ${styles.deleteButton}`}
                          onClick={() => deleteAttempt(attempt.id)} disabled={deletingAttemptId === attempt.id}
                          aria-label={`${txt.deleteAttempt} — ${exercise.name}`} title={txt.deleteAttempt}><Trash2 size={16} aria-hidden="true" /></button> : null}
                      </div>)}
                    </div>}
                  </div>
                </div> : null}
              </article>;
            })}
          </div>
        </section> : null}
      </div> : null}
    </div>
  </div>;
}

function DetailFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className={styles.detailFact}><div>{icon}<strong>{label}</strong></div><p>{value}</p></div>;
}
