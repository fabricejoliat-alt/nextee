"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Lock, ShieldCheck, Sparkles, Target, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import {
  getValidationBadgeColors,
  getValidationBadgeLabel,
  type ValidationDashboardPayload,
  type ValidationExerciseItem,
  type ValidationSectionItem,
} from "@/lib/validations";

function labelByLocale(locale: string, fr: string, en: string) {
  return locale === "fr" ? fr : en;
}

function progressRatio(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function toDateLocalValue(value: Date) {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatAttemptDate(locale: string, value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function ProgressBar({
  value,
  total,
  fill,
}: {
  value: number;
  total: number;
  fill: string;
}) {
  const width = `${progressRatio(value, total)}%`;
  return (
    <div className="bar">
      <span
        style={{
          width,
          background: fill,
        }}
      />
    </div>
  );
}

function BadgePill({ locale, badge }: { locale: string; badge: ValidationSectionItem["badge"] }) {
  const colors = getValidationBadgeColors(badge);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        letterSpacing: 0.2,
        background: colors.background,
        color: colors.color,
        border: badge === "none" ? "1px solid rgba(15,23,42,0.08)" : "none",
      }}
    >
      <ShieldCheck size={14} />
      {getValidationBadgeLabel(locale, badge)}
    </span>
  );
}

export default function PlayerValidationsPage() {
  const { locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ValidationDashboardPayload | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [attemptDateDrafts, setAttemptDateDrafts] = useState<Record<string, string>>({});
  const [expandedExerciseIds, setExpandedExerciseIds] = useState<Record<string, boolean>>({});

  const txt = useMemo(
    () => ({
      title: labelByLocale(locale, "Validations", "Validations"),
      heroTitle: labelByLocale(
        locale,
        "Valide tous ces défis et deviens un joueur Elite !",
        "Complete all these challenges and become an Elite player!"
      ),
      heroText: labelByLocale(
        locale,
        "Chaque exercice se débloque une fois que le précédent est validé. Cette progression t'aide à renforcer ton jeu, mieux gérer le stress et gagner en régularite sur le parcours.",
        "Each exercise unlocks once the previous one is validated. This progression helps strengthen your game, manage stress better, and become more consistent on the course."
      ),
      loading: labelByLocale(locale, "Chargement des validations…", "Loading validations…"),
      overall: labelByLocale(locale, "Progression globale", "Overall progress"),
      attempts: labelByLocale(locale, "tentatives", "attempts"),
      history: labelByLocale(locale, "Historique des essais", "Attempt history"),
      objective: labelByLocale(locale, "Objectif", "Goal"),
      instruction: labelByLocale(locale, "Consigne", "Instruction"),
      equipment: labelByLocale(locale, "Matériel", "Equipment"),
      validation: labelByLocale(locale, "Validation", "Validation"),
      note: labelByLocale(locale, "Score/note", "Score/note"),
      success: labelByLocale(locale, "Réussi", "Success"),
      failure: labelByLocale(locale, "Manqué", "Missed"),
      locked: labelByLocale(locale, "Verrouillé", "Locked"),
      unlocked: labelByLocale(locale, "Débloqué", "Unlocked"),
      validated: labelByLocale(locale, "Validé", "Validated"),
      noHistory: labelByLocale(locale, "Aucun essai enregistré.", "No attempts recorded."),
      level: labelByLocale(locale, "Niveau", "Level"),
      dateTime: labelByLocale(locale, "Date", "Date"),
      recordDisabled: labelByLocale(
        locale,
        "Consultation seule pour ce profil.",
        "Read-only access for this profile."
      ),
      saved: labelByLocale(locale, "Essai enregistré.", "Attempt saved."),
      sectionScore: labelByLocale(locale, "Score section", "Section score"),
      globalScore: labelByLocale(locale, "Score global", "Overall score"),
    }),
    [locale]
  );

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session.");
      const ctx = await resolveEffectivePlayerContext();
      const qs = ctx.role === "parent" && ctx.effectiveUserId ? `?child_id=${encodeURIComponent(ctx.effectiveUserId)}` : "";
      const res = await fetch(`/api/player/validations${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Erreur de chargement.");
      const payload = json as ValidationDashboardPayload;
      setDashboard(payload);
      setSelectedSectionId((current) => current || payload.sections[0]?.id || "");
    } catch (err: unknown) {
      setDashboard(null);
      setError(err instanceof Error ? err.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const selectedSection = useMemo(
    () => dashboard?.sections.find((section) => section.id === selectedSectionId) ?? dashboard?.sections[0] ?? null,
    [dashboard, selectedSectionId]
  );

  const visibleExercise = useMemo(() => {
    if (!selectedSection) return null;
    const unlocked = selectedSection.exercises.filter((exercise) => exercise.is_unlocked);
    if (unlocked.length === 0) return null;
    return unlocked[unlocked.length - 1] ?? null;
  }, [selectedSection]);

  const visibleExercises = useMemo(() => {
    if (!selectedSection) return [];
    return selectedSection.exercises.filter((exercise) => exercise.is_unlocked);
  }, [selectedSection]);

  const overallAttemptCount = useMemo(() => {
    if (!dashboard) return 0;
    return dashboard.sections.reduce(
      (sum, section) => sum + section.exercises.reduce((exerciseSum, exercise) => exerciseSum + exercise.attempts.length, 0),
      0
    );
  }, [dashboard]);

  useEffect(() => {
    if (!visibleExercise) return;
    setAttemptDateDrafts((current) => {
      if (current[visibleExercise.id]) return current;
      return {
        ...current,
        [visibleExercise.id]: toDateLocalValue(new Date()),
      };
    });
  }, [visibleExercise]);

  useEffect(() => {
    if (!visibleExercise) return;
    setExpandedExerciseIds((current) => {
      if (current[visibleExercise.id] !== undefined) return current;
      return { ...current, [visibleExercise.id]: !visibleExercise.is_validated };
    });
  }, [visibleExercise]);

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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
      const payload = json.dashboard as ValidationDashboardPayload;
      setDashboard(payload);
      if (result === "success") {
        setExpandedExerciseIds((current) => ({ ...current, [exercise.id]: false }));
      }
      setInfo(txt.saved);
      setNoteDrafts((current) => ({ ...current, [exercise.id]: "" }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur d'enregistrement.");
    } finally {
      setSubmittingId("");
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {txt.title}
            </div>
          </div>

          {error ? (
            <div style={{ marginTop: 12, ...messageBox("rgba(185,28,28,0.08)", "rgba(185,28,28,0.22)", "#991b1b") }}>{error}</div>
          ) : null}
          {info ? (
            <div
              style={{
                marginTop: 12,
                borderRadius: 14,
                padding: "14px 16px",
                background: "linear-gradient(135deg, rgba(22,101,52,0.95), rgba(21,128,61,0.92))",
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "white",
                fontWeight: 800,
                boxShadow: "0 4px 12px rgba(22,101,52,0.25)",
              }}
            >
              <CheckCircle2 size={20} />
              {info}
            </div>
          ) : null}

          {loading || !dashboard ? (
            <div style={{ marginTop: 12 }}>
              <ListLoadingBlock label={txt.loading} />
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gap: 14 }}>
                <div
                  style={{
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "rgba(0,0,0,0.08)",
                    background: "rgba(255,255,255,0.72)",
                    borderRadius: 16,
                    padding: "18px 16px",
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.2, color: "rgba(15,23,42,0.96)" }}>
                      {txt.heroTitle}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, fontWeight: 800, color: "rgba(0,0,0,0.58)" }}>
                      {txt.heroText}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {txt.overall}
                      </div>
                      <div className="big-number" style={{ lineHeight: 1.05, marginTop: 6 }}>
                        {dashboard.overall_validated_count}/{dashboard.overall_total_count}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.58)" }}>
                      {overallAttemptCount} {txt.attempts}
                    </div>
                  </div>
                  <ProgressBar
                    value={dashboard.overall_validated_count}
                    total={dashboard.overall_total_count}
                    fill="linear-gradient(90deg, var(--green-light), var(--green-dark))"
                  />
                </div>

                <div
                  style={{
                    border: "1px solid rgba(15,23,42,0.08)",
                    borderRadius: 18,
                    padding: 16,
                    background: "rgba(255,255,255,0.92)",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {labelByLocale(locale, "Secteurs", "Sections")}
                      </div>
                    </div>
                    {selectedSection ? <BadgePill locale={locale} badge={selectedSection.badge} /> : null}
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {dashboard.sections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setSelectedSectionId(section.id)}
                        style={{
                          textAlign: "left",
                          borderRadius: 14,
                          border: section.id === selectedSection?.id ? "1px solid rgba(22,101,52,0.16)" : "1px solid rgba(15,23,42,0.08)",
                          background: section.id === selectedSection?.id ? "rgba(22,101,52,0.07)" : "white",
                          padding: 12,
                          display: "grid",
                          gap: 8,
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <div className="bar-row" style={{ flex: 1, marginBottom: 0 }}>
                            <span>{section.name}</span>
                            <span>{section.validated_count}/{section.total_count}</span>
                          </div>
                        </div>
                        <ProgressBar
                          value={section.validated_count}
                          total={section.total_count}
                          fill="linear-gradient(90deg, var(--green-light), var(--green-dark))"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {selectedSection ? (
                <section className="glass-section" style={{ marginTop: 14 }}>
                  <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>
                      {labelByLocale(locale, "Les défis ", "The challenges ")}{selectedSection.name}
                    </div>
                    {visibleExercise ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        {visibleExercises.map((exercise) => {
                          const isCompact = exercise.is_validated && !expandedExerciseIds[exercise.id];
                          const resultColor = exercise.is_validated
                            ? "#166534"
                            : exercise.is_unlocked
                            ? "#166534"
                            : "rgba(15,23,42,0.52)";
                          return (
                            <div
                              key={exercise.id}
                              style={{
                                border: "1px solid rgba(15,23,42,0.08)",
                                borderRadius: 18,
                                padding: 16,
                                background: "rgba(255,255,255,0.96)",
                                display: "grid",
                                gap: 12,
                                opacity: exercise.is_unlocked ? 1 : 0.78,
                              }}
                            >
                            {isCompact ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedExerciseIds((current) => ({ ...current, [exercise.id]: true }))
                                }
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  margin: 0,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 12,
                                  alignItems: "center",
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                              >
                                <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      minWidth: 34,
                                      height: 34,
                                      borderRadius: 999,
                                      background: "rgba(15,23,42,0.08)",
                                      fontSize: 13,
                                      fontWeight: 900,
                                      color: "rgba(15,23,42,0.88)",
                                    }}
                                  >
                                    {exercise.sequence_no}
                                  </span>
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontSize: 16,
                                        fontWeight: 900,
                                        color: "rgba(15,23,42,0.96)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                      }}
                                    >
                                      {exercise.name}
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                                  <span style={statusPill(resultColor)}>
                                    <CheckCircle2 size={14} />
                                    {txt.validated}
                                  </span>
                                </div>
                              </button>
                            ) : (
                              <>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                              <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      minWidth: 34,
                                      height: 34,
                                      borderRadius: 999,
                                      background: "rgba(15,23,42,0.08)",
                                      fontSize: 13,
                                      fontWeight: 900,
                                    }}
                                  >
                                    {exercise.sequence_no}
                                  </span>
                                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>{exercise.name}</h3>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={statusPill(resultColor)}>
                                    {exercise.is_validated ? (
                                      <>
                                        <CheckCircle2 size={14} />
                                        {txt.validated}
                                      </>
                                    ) : exercise.is_unlocked ? (
                                      <>
                                        <Target size={14} />
                                        {txt.unlocked}
                                      </>
                                    ) : (
                                      <>
                                        <Lock size={14} />
                                        {txt.locked}
                                      </>
                                    )}
                                  </span>
                                  {exercise.level != null ? (
                                    <span style={softPill()}>
                                      {txt.level} {exercise.level}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              {exercise.is_validated ? (
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() =>
                                    setExpandedExerciseIds((current) => ({ ...current, [exercise.id]: false }))
                                  }
                                  style={{
                                    background: "white",
                                    color: "rgba(15,23,42,0.72)",
                                    border: "1px solid rgba(15,23,42,0.12)",
                                  }}
                                >
                                  {labelByLocale(locale, "Reduire", "Collapse")}
                                </button>
                              ) : null}
                            </div>

                            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                              {exercise.objective ? <DetailCard label={txt.objective} value={exercise.objective} /> : null}
                              {(exercise.detailed_description || exercise.short_description) ? (
                                <DetailCard label={txt.instruction} value={exercise.detailed_description || exercise.short_description || ""} />
                              ) : null}
                              {exercise.equipment ? <DetailCard label={txt.equipment} value={exercise.equipment} /> : null}
                              {exercise.validation_rule_text ? <DetailCard label={txt.validation} value={exercise.validation_rule_text} /> : null}
                            </div>

                            <div style={{ display: "grid", gap: 10 }}>
                              <label style={{ display: "grid", gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(15,23,42,0.62)" }}>{txt.dateTime}</span>
                                <input
                                  type="date"
                                  value={attemptDateDrafts[exercise.id] ?? ""}
                                  onChange={(event) =>
                                    setAttemptDateDrafts((current) => ({ ...current, [exercise.id]: event.target.value }))
                                  }
                                  disabled={!dashboard.can_record_attempts || !exercise.is_unlocked || submittingId === exercise.id}
                                  style={inputStyle}
                                />
                              </label>

                              <label style={{ display: "grid", gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(15,23,42,0.62)" }}>{txt.note}</span>
                                <textarea
                                  value={noteDrafts[exercise.id] ?? ""}
                                  onChange={(event) =>
                                    setNoteDrafts((current) => ({ ...current, [exercise.id]: event.target.value }))
                                  }
                                  rows={2}
                                  disabled={!dashboard.can_record_attempts || !exercise.is_unlocked || submittingId === exercise.id}
                                  style={textAreaStyle}
                                />
                              </label>

                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={!dashboard.can_record_attempts || !exercise.is_unlocked || submittingId === exercise.id}
                                  onClick={() => saveAttempt(exercise, "success")}
                                  style={{
                                    background: "linear-gradient(135deg, rgba(22,101,52,0.98), rgba(21,128,61,0.94))",
                                    color: "white",
                                    border: "none",
                                  }}
                                >
                                  <CheckCircle2 size={16} />
                                  {submittingId === exercise.id ? txt.loading : txt.success}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={!dashboard.can_record_attempts || !exercise.is_unlocked || submittingId === exercise.id}
                                  onClick={() => saveAttempt(exercise, "failure")}
                                  style={{
                                    background: "white",
                                    color: "#991b1b",
                                    border: "1px solid rgba(185,28,28,0.22)",
                                  }}
                                >
                                  <XCircle size={16} />
                                  {txt.failure}
                                </button>
                                {!dashboard.can_record_attempts ? (
                                  <span style={softPill()}>{txt.recordDisabled}</span>
                                ) : null}
                              </div>
                            </div>

                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ fontSize: 13, fontWeight: 900 }}>{txt.history}</div>
                              {exercise.attempts.length === 0 ? (
                                <div style={{ fontSize: 13, color: "rgba(15,23,42,0.62)", fontWeight: 700 }}>{txt.noHistory}</div>
                              ) : (
                                <div style={{ display: "grid", gap: 8 }}>
                                  {exercise.attempts.map((attempt) => (
                                    <div
                                      key={attempt.id}
                                      style={{
                                        borderRadius: 12,
                                        border: "1px solid rgba(15,23,42,0.08)",
                                        padding: "10px 12px",
                                        background: "rgba(255,255,255,0.92)",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 12,
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span style={attempt.result === "success" ? successMiniPill : failureMiniPill}>
                                        {attempt.result === "success" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                                        {attempt.result === "success" ? txt.success : txt.failure}
                                      </span>
                                      {attempt.note ? (
                                        <div style={{ fontSize: 13, color: "rgba(15,23,42,0.78)", whiteSpace: "pre-wrap", flex: 1, minWidth: 100 }}>
                                          {attempt.note}
                                        </div>
                                      ) : null}
                                      <div
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                          fontSize: 12,
                                          color: "rgba(15,23,42,0.62)",
                                          fontWeight: 800,
                                        }}
                                      >
                                        <Clock3 size={14} />
                                        {formatAttemptDate(locale, attempt.attempted_at)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                              </>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.08)",
        borderRadius: 14,
        padding: 12,
        background: "rgba(255,255,255,0.94)",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, color: "rgba(15,23,42,0.56)", fontWeight: 900 }}>{label}</div>
      <div style={{ fontSize: 14, lineHeight: 1.5, fontWeight: 700, color: "rgba(15,23,42,0.88)" }}>{value}</div>
    </div>
  );
}

function messageBox(background: string, border: string, color: string): CSSProperties {
  return {
    border: `1px solid ${border}`,
    background,
    color,
    borderRadius: 14,
    padding: 12,
    fontWeight: 800,
  };
}

function statusPill(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.08)",
    fontSize: 12,
    fontWeight: 900,
    color,
    background: "rgba(255,255,255,0.9)",
  };
}

function softPill(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.08)",
    fontSize: 12,
    fontWeight: 800,
    color: "rgba(15,23,42,0.72)",
    background: "rgba(255,255,255,0.9)",
  };
}

const textAreaStyle: CSSProperties = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.12)",
  background: "white",
  padding: "10px 12px",
  resize: "vertical",
  minHeight: 68,
  font: "inherit",
};

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.12)",
  background: "white",
  padding: "10px 12px",
  font: "inherit",
};

const successMiniPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  width: "fit-content",
  padding: "5px 9px",
  borderRadius: 999,
  background: "rgba(22,163,74,0.1)",
  color: "#166534",
  fontSize: 12,
  fontWeight: 900,
};

const failureMiniPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  width: "fit-content",
  padding: "5px 9px",
  borderRadius: 999,
  background: "rgba(185,28,28,0.08)",
  color: "#991b1b",
  fontSize: 12,
  fontWeight: 900,
};
