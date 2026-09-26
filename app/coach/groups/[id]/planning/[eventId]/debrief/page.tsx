"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { Bot, Check, ChevronLeft, Save, ShieldCheck, Sparkles, UserCheck, UserX } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import type { CoachAttendanceStatus, CoachReportScope } from "@/lib/coachDebrief";
import styles from "./CoachDebrief.module.css";

type PlayerProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type ReviewDraft = {
  player_id: string;
  status: CoachAttendanceStatus | null;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  profile: PlayerProfile | null;
};

type AiProposal = {
  local_id: string;
  included: boolean;
  player_id: string;
  text: string;
  rationale: string;
  confidence: "high" | "medium";
};

type EventRow = {
  id: string;
  title: string | null;
  starts_at: string;
  location_text: string | null;
};

type DebriefApiAttendee = {
  player_id: string;
  coach_recorded_status: string | null;
  feedback?: { engagement?: number | null; attitude?: number | null; performance?: number | null } | null;
  profile?: PlayerProfile | null;
};

type DebriefAiProposal = {
  player_id?: string;
  text?: string;
  rationale?: string;
  confidence?: string;
};

function playerName(profile: PlayerProfile | null) {
  return `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "—";
}

function initials(profile: PlayerProfile | null) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "?";
}

function isComplete(review: ReviewDraft) {
  if (review.status === "absent") return true;
  if (review.status !== "present") return false;
  return [review.engagement, review.attitude, review.performance].every(
    (value) => typeof value === "number" && value >= 1 && value <= 6
  );
}

function formatMoment(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : locale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function CoachTrainingDebriefPage() {
  const params = useParams<{ id: string; eventId: string }>();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const { locale, t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [groupName, setGroupName] = useState("");
  const [reviews, setReviews] = useState<ReviewDraft[]>([]);
  const [reportText, setReportText] = useState("");
  const [reportScope, setReportScope] = useState<CoachReportScope>("mixed");
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [analysisReportVersion, setAnalysisReportVersion] = useState<number | null>(null);
  const [assistanceEnabled, setAssistanceEnabled] = useState(false);

  const backHref = `/coach/groups/${groupId}/planning/${eventId}`;
  const completedCount = reviews.filter(isComplete).length;
  const presentReviews = reviews.filter((review) => review.status === "present");
  const allComplete = completedCount === reviews.length;

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? "";
        if (!token) throw new Error("Session invalide.");
        const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/debrief`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Erreur chargement."));
        if (!active) return;

        setEvent((json?.event ?? null) as EventRow | null);
        setGroupName(String(json?.groupName ?? ""));
        setAssistanceEnabled(json?.coachTrainingAssistanceEnabled === true);
        setReportText(String(json?.debrief?.report_text ?? ""));
        const scope = String(json?.debrief?.report_scope ?? "mixed");
        setReportScope(scope === "collective" || scope === "individual" ? scope : "mixed");
        setReviews(
          ((Array.isArray(json?.attendees) ? json.attendees : []) as DebriefApiAttendee[]).map((row) => ({
            player_id: String(row.player_id),
            status:
              row.coach_recorded_status === "present" || row.coach_recorded_status === "absent"
                ? row.coach_recorded_status
                : null,
            engagement: typeof row.feedback?.engagement === "number" ? row.feedback.engagement : null,
            attitude: typeof row.feedback?.attitude === "number" ? row.feedback.attitude : null,
            performance: typeof row.feedback?.performance === "number" ? row.feedback.performance : null,
            profile: (row.profile ?? null) as PlayerProfile | null,
          }))
        );
      } catch (caught: unknown) {
        if (active) setError(caught instanceof Error ? caught.message : "Erreur chargement.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId]);

  function updateReview(playerId: string, patch: Partial<ReviewDraft>) {
    setMessage(null);
    setProposals([]);
    setAnalysisDone(false);
    setAnalysisReportVersion(null);
    setReviews((current) => current.map((review) => (review.player_id === playerId ? { ...review, ...patch } : review)));
  }

  function setStatus(playerId: string, status: CoachAttendanceStatus) {
    updateReview(
      playerId,
      status === "absent"
        ? { status, engagement: null, attitude: null, performance: null }
        : { status }
    );
  }

  async function authToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    if (!token) throw new Error("Session invalide.");
    return token;
  }

  async function saveDebrief(options?: { quiet?: boolean }) {
    setError(null);
    setMessage(null);
    if (!allComplete) {
      setError(t("coachDebrief.incomplete"));
      return false;
    }

    setBusy(true);
    try {
      const token = await authToken();
      const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/debrief`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          report_text: assistanceEnabled ? reportText : "",
          report_scope: reportScope,
          reviews: reviews.map(({ player_id, status, engagement, attitude, performance }) => ({
            player_id,
            status,
            engagement,
            attitude,
            performance,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Save failed"));
      if (!options?.quiet) setMessage(t("coachDebrief.saved"));
      return true;
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function analyzeReport() {
    if (!reportText.trim()) {
      setError(t("coachDebrief.reportStep"));
      return;
    }
    if (!(await saveDebrief({ quiet: true }))) return;

    setAnalyzing(true);
    setError(null);
    setMessage(null);
    try {
      const token = await authToken();
      const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/debrief/analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "AI analysis failed"));
      setProposals(
        ((Array.isArray(json?.proposals) ? json.proposals : []) as DebriefAiProposal[]).map((proposal, index) => ({
          local_id: `${index}-${String(proposal.player_id)}`,
          included: true,
          player_id: String(proposal.player_id),
          text: String(proposal.text ?? ""),
          rationale: String(proposal.rationale ?? ""),
          confidence: proposal.confidence === "high" ? "high" : "medium",
        }))
      );
      setAnalysisReportVersion(Number(json?.reportVersion ?? 0) || null);
      setAnalysisDone(true);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "AI analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function validateNotes() {
    const selected = proposals.filter((proposal) => proposal.included && proposal.text.trim());
    if (selected.length === 0) {
      setError(t("coachDebrief.noProposals"));
      return;
    }
    setValidating(true);
    setError(null);
    setMessage(null);
    try {
      const token = await authToken();
      const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/debrief/notes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: selected.map(({ player_id, text }) => ({ player_id, text })),
          report_version: analysisReportVersion,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Validation failed"));
      setMessage(`${Number(json?.inserted ?? selected.length)} ${t("coachDebrief.validated")}`);
      setProposals([]);
      setAnalysisDone(false);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  if (loading) {
    return (
      <div className="player-dashboard-bg">
        <main className={styles.page} aria-busy="true">
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonGrid}>
            <div className={styles.skeletonCard} />
            <div className={styles.skeletonCard} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="player-dashboard-bg">
      <main className={styles.page}>
        <header className={styles.header}>
          <Link href={backHref} className={styles.backLink}>
            <ChevronLeft size={18} aria-hidden="true" />
            {t("coachDebrief.back")}
          </Link>
          <div>
            <div className={styles.eyebrow}>{groupName}</div>
            <h1 className={styles.title}>
              {assistanceEnabled ? t("coachDebrief.title") : t("coachDebrief.attendanceTitle")}
            </h1>
            {event ? (
              <div className={styles.eventMeta}>
                {event.title ? `${event.title} • ` : ""}{formatMoment(event.starts_at, locale)}
                {event.location_text ? ` • ${event.location_text}` : ""}
              </div>
            ) : null}
          </div>
          <p className={styles.intro}>
            {assistanceEnabled ? t("coachDebrief.intro") : t("coachDebrief.attendanceIntro")}
          </p>
        </header>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {message ? <div className={styles.success} role="status"><Check size={18} />{message}</div> : null}

        <div className={styles.layout}>
          <section className={styles.primaryColumn} aria-labelledby="attendance-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="attendance-title">{t("coachDebrief.presenceStep")}</h2>
                <p>{t("coachDebrief.noPreset")}</p>
              </div>
              <div className={styles.progress} aria-live="polite">
                <strong>{completedCount}/{reviews.length}</strong>
                <span>{t("coachDebrief.progress")}</span>
              </div>
            </div>

            <div className={styles.playerList}>
              {reviews.length === 0 ? <div className={styles.absentMessage}>{t("common.noData")}</div> : null}
              {reviews.map((review) => (
                <article className={`${styles.playerCard} ${isComplete(review) ? styles.playerCardComplete : ""}`} key={review.player_id}>
                  <div className={styles.playerTopline}>
                    <div className={styles.playerIdentity}>
                      <div className={styles.avatar} aria-hidden="true">
                        {review.profile?.avatar_url ? (
                          <Image src={review.profile.avatar_url} alt="" width={46} height={46} unoptimized />
                        ) : initials(review.profile)}
                      </div>
                      <div>
                        <h3>{playerName(review.profile)}</h3>
                        {isComplete(review) ? <span className={styles.completeLabel}><Check size={14} /> OK</span> : null}
                      </div>
                    </div>
                    <div className={styles.statusChoice} role="group" aria-label={playerName(review.profile)}>
                      <button
                        type="button"
                        className={review.status === "absent" ? styles.statusActiveAbsent : ""}
                        aria-pressed={review.status === "absent"}
                        onClick={() => setStatus(review.player_id, "absent")}
                      >
                        <UserX size={18} />{t("coachDebrief.absent")}
                      </button>
                      <button
                        type="button"
                        className={review.status === "present" ? styles.statusActivePresent : ""}
                        aria-pressed={review.status === "present"}
                        onClick={() => setStatus(review.player_id, "present")}
                      >
                        <UserCheck size={18} />{t("coachDebrief.present")}
                      </button>
                    </div>
                  </div>

                  {review.status === "present" ? (
                    <div className={styles.ratings}>
                      {([
                        ["engagement", t("coachDebrief.engagement")],
                        ["attitude", t("coachDebrief.attitude")],
                        ["performance", t("coachDebrief.application")],
                      ] as const).map(([key, label]) => (
                        <div className={styles.ratingRow} key={key}>
                          <span>{label}</span>
                          <div className={styles.ratingButtons} role="radiogroup" aria-label={`${playerName(review.profile)} — ${label}`}>
                            {[1, 2, 3, 4, 5, 6].map((value) => (
                              <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={review[key] === value}
                                className={review[key] === value ? styles.ratingActive : ""}
                                onClick={() => updateReview(review.player_id, { [key]: value })}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : review.status === "absent" ? (
                    <div className={styles.absentMessage}>{t("coachDebrief.absentNoRating")}</div>
                  ) : null}
                </article>
              ))}
            </div>
            {!assistanceEnabled ? (
              <div className={styles.attendanceActionBar}>
                <button type="button" className={styles.primaryAction} disabled={busy || validating} onClick={() => void saveDebrief()}>
                  <Save size={18} />{busy ? t("coachDebrief.saving") : t("coachDebrief.saveAttendance")}
                </button>
              </div>
            ) : null}
          </section>

          <div className={styles.secondaryColumn}>
            {assistanceEnabled ? <section className={styles.reportCard} aria-labelledby="report-title">
              <div className={styles.sectionHeaderCompact}>
                <div>
                  <h2 id="report-title">{t("coachDebrief.reportStep")}</h2>
                  <p>{t("coachDebrief.reportHelp")}</p>
                </div>
              </div>

              <div className={styles.scopeChoice} role="group" aria-label={t("coachDebrief.reportStep")}>
                {([
                  ["collective", t("coachDebrief.collective")],
                  ["individual", t("coachDebrief.individual")],
                  ["mixed", t("coachDebrief.mixed")],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={reportScope === value}
                    className={reportScope === value ? styles.scopeActive : ""}
                    onClick={() => {
                      setReportScope(value);
                      setProposals([]);
                      setAnalysisDone(false);
                      setAnalysisReportVersion(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <textarea
                className={styles.reportTextarea}
                value={reportText}
                onChange={(event) => {
                  setReportText(event.target.value);
                  setProposals([]);
                  setAnalysisDone(false);
                  setAnalysisReportVersion(null);
                }}
                placeholder={t("coachDebrief.reportPlaceholder")}
                maxLength={10000}
                rows={9}
              />
              <div className={styles.characterCount}>{reportText.length}/10 000</div>

              <div className={styles.aiDisclosure}>
                <ShieldCheck size={18} aria-hidden="true" />
                <span>{t("coachDebrief.aiDisclosure")}</span>
              </div>

              <div className={styles.actionBar}>
                <button type="button" className={styles.secondaryAction} disabled={busy || analyzing || validating} onClick={() => void saveDebrief()}>
                  <Save size={18} />{busy ? t("coachDebrief.saving") : t("coachDebrief.save")}
                </button>
                <button
                  type="button"
                  className={styles.primaryAction}
                  disabled={busy || analyzing || validating || !reportText.trim() || !allComplete}
                  onClick={() => void analyzeReport()}
                >
                  <Sparkles size={18} />{analyzing ? t("coachDebrief.analyzing") : t("coachDebrief.analyze")}
                </button>
              </div>
            </section> : null}

            {assistanceEnabled && (analysisDone || proposals.length > 0) ? (
              <section className={styles.proposalsCard} aria-labelledby="proposals-title">
                <div className={styles.proposalsHeading}>
                  <Bot size={22} aria-hidden="true" />
                  <h2 id="proposals-title">{t("coachDebrief.proposalsStep")}</h2>
                </div>
                {proposals.length === 0 ? (
                  <p className={styles.emptyProposals}>{t("coachDebrief.noProposals")}</p>
                ) : (
                  <div className={styles.proposalList}>
                    {proposals.map((proposal) => (
                      <article className={styles.proposal} key={proposal.local_id}>
                        <label className={styles.includeToggle}>
                          <input
                            type="checkbox"
                            checked={proposal.included}
                            onChange={(event) =>
                              setProposals((current) =>
                                current.map((item) => item.local_id === proposal.local_id ? { ...item, included: event.target.checked } : item)
                              )
                            }
                          />
                          <span>{t("coachDebrief.include")}</span>
                        </label>
                        <label className={styles.field}>
                          <span>{t("coachDebrief.player")}</span>
                          <select
                            value={proposal.player_id}
                            disabled={!proposal.included}
                            onChange={(event) =>
                              setProposals((current) =>
                                current.map((item) => item.local_id === proposal.local_id ? { ...item, player_id: event.target.value } : item)
                              )
                            }
                          >
                            {presentReviews.map((review) => <option key={review.player_id} value={review.player_id}>{playerName(review.profile)}</option>)}
                          </select>
                        </label>
                        <label className={styles.field}>
                          <span>{t("coachDebrief.privateNote")}</span>
                          <textarea
                            value={proposal.text}
                            disabled={!proposal.included}
                            maxLength={4000}
                            rows={4}
                            onChange={(event) =>
                              setProposals((current) =>
                                current.map((item) => item.local_id === proposal.local_id ? { ...item, text: event.target.value } : item)
                              )
                            }
                          />
                        </label>
                        <details className={styles.rationale}>
                          <summary>{t("coachDebrief.rationale")}</summary>
                          <p>{proposal.rationale}</p>
                        </details>
                      </article>
                    ))}
                  </div>
                )}
                {proposals.length > 0 ? (
                  <button type="button" className={styles.validateAction} disabled={validating} onClick={() => void validateNotes()}>
                    <Check size={18} />{validating ? t("coachDebrief.validating") : t("coachDebrief.validate")}
                  </button>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
