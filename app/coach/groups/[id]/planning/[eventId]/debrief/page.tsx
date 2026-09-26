"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  UserCheck,
  UserX,
} from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import {
  needsCoachPlayerEvaluation,
  type CoachAttendanceStatus,
  type CoachIndividualComments,
} from "@/lib/coachDebrief";
import styles from "./CoachDebrief.module.css";

type PlayerProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type ReviewDraft = {
  player_id: string;
  status: CoachAttendanceStatus;
  statusRecorded: boolean;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  persisted: boolean;
  profile: PlayerProfile | null;
};

type AiProposal = {
  player_id: string;
  text: string;
  rationale: string;
  confidence: "high" | "medium";
};

type IndividualAiState = {
  analyzing: boolean;
  approved: boolean;
  error: string | null;
  success: string | null;
  proposal: AiProposal | null;
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
  feedback?: {
    engagement?: number | null;
    attitude?: number | null;
    performance?: number | null;
    player_note?: string | null;
    private_note?: string | null;
  } | null;
  profile?: PlayerProfile | null;
};

type DebriefApiRecord = {
  individual_comments?: Record<string, unknown> | null;
};

type DebriefAiProposal = {
  player_id?: string;
  text?: string;
  rationale?: string;
  confidence?: string;
};

const EMPTY_AI_STATE: IndividualAiState = {
  analyzing: false,
  approved: false,
  error: null,
  success: null,
  proposal: null,
};

function playerName(profile: PlayerProfile | null) {
  return `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "—";
}

function initials(profile: PlayerProfile | null) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "?";
}

function hasAllRatings(review: ReviewDraft) {
  return [review.engagement, review.attitude, review.performance].every(
    (value) => typeof value === "number" && value >= 1 && value <= 6
  );
}

function isEvaluationComplete(review: ReviewDraft) {
  return review.persisted && (review.status === "absent" || hasAllRatings(review));
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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [groupName, setGroupName] = useState("");
  const [reviews, setReviews] = useState<ReviewDraft[]>([]);
  const [individualComments, setIndividualComments] = useState<CoachIndividualComments>({});
  const [privateNotes, setPrivateNotes] = useState<CoachIndividualComments>({});
  const [individualAi, setIndividualAi] = useState<Record<string, IndividualAiState>>({});
  const [privateNoteAi, setPrivateNoteAi] = useState<Record<string, IndividualAiState>>({});
  const [assistanceEnabled, setAssistanceEnabled] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flowComplete, setFlowComplete] = useState(false);
  const saveInFlightRef = useRef(false);

  const backHref = `/coach/groups/${groupId}/planning/${eventId}`;
  const currentReview = reviews[currentIndex] ?? null;
  const currentAi = currentReview ? individualAi[currentReview.player_id] ?? EMPTY_AI_STATE : EMPTY_AI_STATE;
  const currentPrivateAi = currentReview ? privateNoteAi[currentReview.player_id] ?? EMPTY_AI_STATE : EMPTY_AI_STATE;
  const completedCount = reviews.filter(isEvaluationComplete).length;

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
        const debrief = (json?.debrief ?? {}) as DebriefApiRecord;
        const rawComments =
          debrief.individual_comments && typeof debrief.individual_comments === "object"
            ? debrief.individual_comments
            : {};
        const loadedReviews = ((Array.isArray(json?.attendees) ? json.attendees : []) as DebriefApiAttendee[]).map(
          (row) => {
            const recordedStatus =
              row.coach_recorded_status === "present" || row.coach_recorded_status === "absent"
                ? row.coach_recorded_status
                : null;
            const engagement = typeof row.feedback?.engagement === "number" ? row.feedback.engagement : null;
            const attitude = typeof row.feedback?.attitude === "number" ? row.feedback.attitude : null;
            const performance = typeof row.feedback?.performance === "number" ? row.feedback.performance : null;
            // Existing absences are shown first and always require explicit confirmation in this guided run.
            const persisted = !needsCoachPlayerEvaluation(
              recordedStatus,
              [engagement, attitude, performance]
            );
            return {
              player_id: String(row.player_id),
              status: recordedStatus ?? "present",
              statusRecorded: recordedStatus != null,
              engagement,
              attitude,
              performance,
              persisted,
              profile: (row.profile ?? null) as PlayerProfile | null,
            } satisfies ReviewDraft;
          }
        );
        setIndividualComments(Object.fromEntries(loadedReviews.map((review) => {
          const attendee = ((json?.attendees ?? []) as DebriefApiAttendee[]).find((row) => row.player_id === review.player_id);
          return [review.player_id, String(attendee?.feedback?.player_note ?? rawComments[review.player_id] ?? "")];
        })));
        setPrivateNotes(Object.fromEntries(loadedReviews.map((review) => {
          const attendee = ((json?.attendees ?? []) as DebriefApiAttendee[]).find((row) => row.player_id === review.player_id);
          return [review.player_id, String(attendee?.feedback?.private_note ?? "")];
        })));
        setReviews(loadedReviews);
        const firstIncomplete = loadedReviews.findIndex((review) => !isEvaluationComplete(review));
        setCurrentIndex(firstIncomplete >= 0 ? firstIncomplete : 0);
        setFlowComplete(loadedReviews.length > 0 && firstIncomplete === -1);
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

  function patchIndividualAi(playerId: string, patch: Partial<IndividualAiState>) {
    setIndividualAi((current) => ({
      ...current,
      [playerId]: { ...(current[playerId] ?? EMPTY_AI_STATE), ...patch },
    }));
  }

  function patchPrivateNoteAi(playerId: string, patch: Partial<IndividualAiState>) {
    setPrivateNoteAi((current) => ({
      ...current,
      [playerId]: { ...(current[playerId] ?? EMPTY_AI_STATE), ...patch },
    }));
  }

  function updateReview(playerId: string, patch: Partial<ReviewDraft>) {
    setError(null);
    setMessage(null);
    setReviews((current) =>
      current.map((review) =>
        review.player_id === playerId ? { ...review, ...patch, persisted: false } : review
      )
    );
  }

  function setStatus(playerId: string, status: CoachAttendanceStatus) {
    patchIndividualAi(playerId, {
      approved: false,
      error: null,
      success: null,
      proposal: status === "absent" ? null : individualAi[playerId]?.proposal ?? null,
    });
    patchPrivateNoteAi(playerId, {
      approved: false,
      error: null,
      success: null,
      proposal: status === "absent" ? null : privateNoteAi[playerId]?.proposal ?? null,
    });
    updateReview(
      playerId,
      status === "absent"
        ? { status, engagement: null, attitude: null, performance: null }
        : { status }
    );
  }

  function updateIndividualComment(playerId: string, value: string) {
    setIndividualComments((current) => ({ ...current, [playerId]: value }));
    patchIndividualAi(playerId, {
      approved: false,
      error: null,
      success: null,
      proposal: null,
    });
    updateReview(playerId, {});
  }

  function updatePrivateNote(playerId: string, value: string) {
    setPrivateNotes((current) => ({ ...current, [playerId]: value }));
    patchPrivateNoteAi(playerId, {
      approved: false,
      error: null,
      success: null,
      proposal: null,
    });
    updateReview(playerId, {});
  }

  async function authToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    if (!token) throw new Error("Session invalide.");
    return token;
  }

  async function analyzeCurrentPlayer() {
    if (!currentReview || currentReview.status !== "present") return;
    const sourceText = String(individualComments[currentReview.player_id] ?? "").trim();
    if (!sourceText) {
      patchIndividualAi(currentReview.player_id, {
        error: t("coachDebrief.individualSourceRequired"),
        success: null,
      });
      return;
    }

    patchIndividualAi(currentReview.player_id, {
      analyzing: true,
      approved: false,
      error: null,
      success: null,
    });
    try {
      const token = await authToken();
      const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/debrief/analyze-player`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentReview.player_id, source_text: sourceText, audience: "junior", locale }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "AI analysis failed"));
      const raw = (json?.proposal ?? {}) as DebriefAiProposal;
      if (String(raw.player_id ?? "") !== currentReview.player_id || !String(raw.text ?? "").trim()) {
        throw new Error("AI returned an invalid player proposal.");
      }
      patchIndividualAi(currentReview.player_id, {
        proposal: {
          player_id: currentReview.player_id,
          text: String(raw.text ?? ""),
          rationale: String(raw.rationale ?? ""),
          confidence: raw.confidence === "high" ? "high" : "medium",
        },
        success: t("coachDebrief.individualProposalReady"),
      });
    } catch (caught: unknown) {
      patchIndividualAi(currentReview.player_id, {
        error: caught instanceof Error ? caught.message : "AI analysis failed",
        proposal: null,
      });
    } finally {
      patchIndividualAi(currentReview.player_id, { analyzing: false });
    }
  }

  async function analyzeCurrentPrivateNote() {
    if (!currentReview || currentReview.status !== "present") return;
    const sourceText = String(privateNotes[currentReview.player_id] ?? "").trim();
    if (!sourceText) {
      patchPrivateNoteAi(currentReview.player_id, {
        error: t("coachDebrief.privateSourceRequired"),
        success: null,
      });
      return;
    }

    patchPrivateNoteAi(currentReview.player_id, {
      analyzing: true,
      approved: false,
      error: null,
      success: null,
    });
    try {
      const token = await authToken();
      const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/debrief/analyze-player`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentReview.player_id, source_text: sourceText, audience: "private", locale }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "AI analysis failed"));
      const raw = (json?.proposal ?? {}) as DebriefAiProposal;
      if (String(raw.player_id ?? "") !== currentReview.player_id || !String(raw.text ?? "").trim()) {
        throw new Error("AI returned an invalid player proposal.");
      }
      patchPrivateNoteAi(currentReview.player_id, {
        proposal: {
          player_id: currentReview.player_id,
          text: String(raw.text ?? ""),
          rationale: String(raw.rationale ?? ""),
          confidence: raw.confidence === "high" ? "high" : "medium",
        },
        success: t("coachDebrief.individualProposalReady"),
      });
    } catch (caught: unknown) {
      patchPrivateNoteAi(currentReview.player_id, {
        error: caught instanceof Error ? caught.message : "AI analysis failed",
        proposal: null,
      });
    } finally {
      patchPrivateNoteAi(currentReview.player_id, { analyzing: false });
    }
  }

  function approveCurrentProposal() {
    if (!currentReview || !currentAi.proposal?.text.trim()) return;
    setIndividualComments((current) => ({
      ...current,
      [currentReview.player_id]: currentAi.proposal?.text.trim() ?? "",
    }));
    updateReview(currentReview.player_id, {});
    patchIndividualAi(currentReview.player_id, {
      approved: true,
      error: null,
      success: t("coachDebrief.proposalApproved"),
    });
  }

  function approveCurrentPrivateProposal() {
    if (!currentReview || !currentPrivateAi.proposal?.text.trim()) return;
    setPrivateNotes((current) => ({
      ...current,
      [currentReview.player_id]: currentPrivateAi.proposal?.text.trim() ?? "",
    }));
    updateReview(currentReview.player_id, {});
    patchPrivateNoteAi(currentReview.player_id, {
      approved: true,
      error: null,
      success: t("coachDebrief.privateProposalApproved"),
    });
  }

  async function saveCurrentEvaluation() {
    if (!currentReview || busy || saveInFlightRef.current) return;
    if (currentReview.status === "present" && !hasAllRatings(currentReview)) {
      patchIndividualAi(currentReview.player_id, {
        error: t("coachDebrief.ratingsRequired"),
        success: null,
      });
      return;
    }

    saveInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    patchIndividualAi(currentReview.player_id, { error: null, success: null });
    patchPrivateNoteAi(currentReview.player_id, { error: null, success: null });
    try {
      const token = await authToken();
      const playerNote = currentReview.status === "present"
        ? String(individualComments[currentReview.player_id] ?? "").trim()
        : "";
      const privateNote = currentReview.status === "present"
        ? String(privateNotes[currentReview.player_id] ?? "").trim() || null
        : null;
      const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/debrief/player`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: currentReview.player_id,
          status: currentReview.status,
          engagement: currentReview.engagement,
          attitude: currentReview.attitude,
          performance: currentReview.performance,
          player_note: playerNote,
          private_note: privateNote,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Save failed"));

      setReviews((current) =>
        current.map((review) =>
          review.player_id === currentReview.player_id
            ? { ...review, persisted: true, statusRecorded: true }
            : review
        )
      );
      patchIndividualAi(currentReview.player_id, {
        approved: false,
        proposal: null,
        success: null,
      });
      patchPrivateNoteAi(currentReview.player_id, {
        approved: false,
        proposal: null,
        success: null,
      });

      if (currentIndex >= reviews.length - 1) {
        setFlowComplete(true);
        setMessage(t("coachDebrief.finishedMessage"));
      } else {
        setMessage(json?.noteInserted === true
          ? t("coachDebrief.individualValidated")
          : t("coachDebrief.playerSaved"));
        setCurrentIndex((index) => Math.min(index + 1, reviews.length - 1));
      }
    } catch (caught: unknown) {
      patchIndividualAi(currentReview.player_id, {
        error: caught instanceof Error ? caught.message : "Save failed",
        success: null,
      });
    } finally {
      saveInFlightRef.current = false;
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="player-dashboard-bg">
        <main className={styles.page} aria-busy="true" aria-label={t("common.loading")}>
          <div className={styles.debriefSkeleton} aria-hidden="true">
            <div className={styles.skeletonBreadcrumb}><span /><span /><span /></div>
            <div className={styles.skeletonHero}>
              <div className={styles.skeletonHeroCopy}>
                <span className={styles.skeletonTitle} />
                <span className={styles.skeletonMeta} />
                <span className={styles.skeletonIntro} />
              </div>
              <span className={styles.skeletonBack} />
            </div>

            <div className={styles.skeletonCards}>
              <section className={styles.skeletonPanel}>
                <div className={styles.skeletonPanelHeader}><span /><i /></div>
                <span className={styles.skeletonProgress} />
                <div className={styles.skeletonPlayer}><i /><div><span /><span /></div></div>
                <div className={styles.skeletonSection}>
                  <span className={styles.skeletonSectionTitle} />
                  <div className={styles.skeletonChoice}><i /><i /></div>
                </div>
                <div className={styles.skeletonSection}>
                  <span className={styles.skeletonSectionTitle} />
                  <div className={styles.skeletonRating}><span /><div>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div></div>
                  <div className={styles.skeletonRating}><span /><div>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div></div>
                  <div className={styles.skeletonRating}><span /><div>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div></div>
                </div>
              </section>

              <section className={styles.skeletonPanel}>
                <span className={styles.skeletonFeedbackTitle} />
                <span className={styles.skeletonFieldLabel} />
                <span className={styles.skeletonHelp} />
                <span className={styles.skeletonTextarea} />
                <span className={styles.skeletonAiButton} />
                <span className={styles.skeletonDivider} />
                <span className={styles.skeletonFieldLabel} />
                <span className={styles.skeletonTextareaSmall} />
              </section>
            </div>
            <div className={styles.skeletonActions}><span /><span /></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="player-dashboard-bg">
      <main className={styles.page}>
        <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
          <Link href="/coach/groups">Coach</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/coach/groups/${groupId}`}>{groupName}</Link>
          <span aria-hidden="true">/</span>
          <span>{t("coachDebrief.title")}</span>
        </nav>
        <header className={styles.header}>
          <div className={styles.heroContent}>
            <div>
              <h1 className={styles.title}>{t("coachDebrief.title")}</h1>
              {event ? (
                <div className={styles.eventMeta}>
                  {event.title ? `${event.title} • ` : ""}{formatMoment(event.starts_at, locale)}
                  {event.location_text ? ` • ${event.location_text}` : ""}
                </div>
              ) : null}
              <p className={styles.intro}>{t("coachDebrief.intro")}</p>
            </div>
          </div>
          <Link href={backHref} className={styles.backLink}>
            <ChevronLeft size={18} aria-hidden="true" />
            {t("coachDebrief.back")}
          </Link>
        </header>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {message ? <div className={styles.success} role="status"><Check size={18} />{message}</div> : null}

        <div className={styles.workflowShell}>
          {reviews.length === 0 ? (
            <section className={styles.workflowCard}>
              <div className={styles.absentMessage}>{t("common.noData")}</div>
            </section>
          ) : flowComplete ? (
            <section className={styles.finishCard} aria-labelledby="evaluation-finished-title">
              <CheckCircle2 size={44} aria-hidden="true" />
              <h2 id="evaluation-finished-title">{t("coachDebrief.finishedTitle")}</h2>
              <p>{t("coachDebrief.finishedMessage")}</p>
              <div className={styles.finishActions}>
                <Link href={backHref} className={styles.primaryAction}>{t("coachDebrief.back")}</Link>
                <button type="button" className={styles.secondaryAction} onClick={() => { setFlowComplete(false); setCurrentIndex(0); setMessage(null); }}>
                  {t("coachDebrief.reviewEvaluations")}
                </button>
              </div>
            </section>
          ) : currentReview ? (
            <>
            {currentAi.error ? <div className={styles.cardError} role="alert">{currentAi.error}</div> : null}
            {currentAi.success ? <div className={styles.cardSuccess} role="status">{currentAi.success}</div> : null}
            {currentPrivateAi.error ? <div className={styles.cardError} role="alert">{currentPrivateAi.error}</div> : null}
            {currentPrivateAi.success ? <div className={styles.cardSuccess} role="status">{currentPrivateAi.success}</div> : null}
            <div className={styles.evaluationCards}>
            <section className={styles.workflowCard} aria-labelledby="current-player-title">
              <div className={styles.workflowHeader}>
                <div>
                  <span className={styles.stepBadge}>
                    {t("coachDebrief.player")} {currentIndex + 1} {t("coachDebrief.of")} {reviews.length}
                  </span>
                  <p>{completedCount}/{reviews.length} {t("coachDebrief.progress")}</p>
                </div>
                {isEvaluationComplete(currentReview) ? (
                  <span className={styles.savedBadge}><Check size={14} />{t("coachDebrief.savedBadge")}</span>
                ) : null}
              </div>
              <div className={styles.progressTrack} role="progressbar" aria-label={t("coachDebrief.progress")} aria-valuemin={1} aria-valuemax={reviews.length} aria-valuenow={currentIndex + 1}>
                <span style={{ width: `${((currentIndex + 1) / reviews.length) * 100}%` }} />
              </div>

              <div className={styles.currentPlayer}>
                <div className={styles.avatar} aria-hidden="true">
                  {currentReview.profile?.avatar_url ? (
                    <Image src={currentReview.profile.avatar_url} alt="" width={58} height={58} unoptimized />
                  ) : initials(currentReview.profile)}
                </div>
                <div><span>{t("coachDebrief.currentPlayer")}</span><h2 id="current-player-title">{playerName(currentReview.profile)}</h2></div>
              </div>

              <div className={styles.sectionBlock}>
                <h3 className={styles.sectionTitle}>1. {t("coachDebrief.presence")}</h3>
                <div className={styles.statusChoice} role="group" aria-label={`${playerName(currentReview.profile)} — ${t("coachDebrief.presence")}`}>
                  <button type="button" className={currentReview.status === "present" ? styles.statusActivePresent : ""} aria-pressed={currentReview.status === "present"} disabled={busy} onClick={() => setStatus(currentReview.player_id, "present")}>
                    <UserCheck size={18} />{t("coachDebrief.present")}
                  </button>
                  <button type="button" className={currentReview.status === "absent" ? styles.statusActiveAbsent : ""} aria-pressed={currentReview.status === "absent"} disabled={busy} onClick={() => setStatus(currentReview.player_id, "absent")}>
                    <UserX size={18} />{t("coachDebrief.absent")}
                  </button>
                </div>
                {!currentReview.statusRecorded ? <p className={styles.defaultHint}>{t("coachDebrief.defaultPresentHint")}</p> : null}
              </div>

              {currentReview.status === "absent" ? (
                <div className={styles.absentMessage}>{t("coachDebrief.absentNoRating")}</div>
              ) : (
                  <div className={styles.sectionBlock}>
                    <h3 className={styles.sectionTitle}>2. {t("coachDebrief.criteria")}</h3>
                    <div className={styles.ratings}>
                      {([[
                        "engagement", t("coachDebrief.engagement")
                      ], [
                        "attitude", t("coachDebrief.attitude")
                      ], [
                        "performance", t("coachDebrief.application")
                      ]] as const).map(([key, label]) => (
                        <div className={styles.ratingRow} key={key}>
                          <span>{label}</span>
                          <div className={styles.ratingButtons} role="radiogroup" aria-label={`${playerName(currentReview.profile)} — ${label}`}>
                            {[1, 2, 3, 4, 5, 6].map((value) => (
                              <button key={value} type="button" role="radio" aria-checked={currentReview[key] === value} className={currentReview[key] === value ? styles.ratingActive : ""} disabled={busy} onClick={() => updateReview(currentReview.player_id, { [key]: value })}>
                                {value}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
              )}
            </section>

              {currentReview.status === "present" ? (
                <section className={`${styles.workflowCard} ${styles.feedbackCard}`} aria-labelledby="activity-feedback-title">
                  <div className={`${styles.sectionBlock} ${styles.feedbackSection}`}>
                      <h3 id="activity-feedback-title" className={styles.sectionTitle}>3. {t("coachDebrief.comment")}</h3>
                      <div className={styles.feedbackNoteBlock}>
                      <label className={styles.commentField}>
                        <span>{t("coachDebrief.commentLabel")}</span>
                        <small className={styles.feedbackExplanation}>{t("coachDebrief.commentHelp")}</small>
                        <textarea aria-label={`${t("coachDebrief.commentLabel")} — ${playerName(currentReview.profile)}`} value={individualComments[currentReview.player_id] ?? ""} disabled={busy || currentAi.analyzing} onChange={(event) => updateIndividualComment(currentReview.player_id, event.target.value)} placeholder={t("coachDebrief.individualCommentPlaceholder")} maxLength={4000} rows={5} />
                        <span className={styles.characterCount}>{String(individualComments[currentReview.player_id] ?? "").length}/4 000</span>
                      </label>

                      {assistanceEnabled ? (
                        <button type="button" className={styles.cardAiAction} disabled={busy || currentAi.analyzing || !String(individualComments[currentReview.player_id] ?? "").trim()} onClick={() => void analyzeCurrentPlayer()}>
                          <Sparkles size={17} aria-hidden="true" />{currentAi.analyzing ? t("coachDebrief.analyzing") : t("coachDebrief.analyzeActivitee")}
                        </button>
                      ) : null}

                      {assistanceEnabled && currentAi.proposal ? (
                        <div className={`${styles.individualProposal} ${currentAi.approved ? styles.proposalApproved : ""}`}>
                          <label>
                            <span>{t("coachDebrief.individualProposalLabel")}</span>
                            <small>{t("coachDebrief.individualProposalHelp")}</small>
                            <textarea value={currentAi.proposal.text} disabled={busy} maxLength={4000} rows={4} onChange={(event) => patchIndividualAi(currentReview.player_id, { approved: false, success: null, proposal: currentAi.proposal ? { ...currentAi.proposal, text: event.target.value } : null })} />
                          </label>
                          <button type="button" className={styles.validatePlayerAction} disabled={busy || currentAi.approved || !currentAi.proposal.text.trim()} onClick={approveCurrentProposal}>
                            <Check size={16} aria-hidden="true" />{currentAi.approved ? t("coachDebrief.proposalApprovedShort") : t("coachDebrief.validateIndividual")}
                          </button>
                        </div>
                      ) : null}
                      </div>

                      <div className={styles.feedbackNoteBlock}>
                      <label className={styles.commentField}>
                        <span>{t("coachDebrief.privateNote")}</span>
                        <small className={styles.privatePreparationHelp}>{t("coachDebrief.privateNoteHelp")}</small>
                        <textarea aria-label={`${t("coachDebrief.privateNote")} — ${playerName(currentReview.profile)}`} value={privateNotes[currentReview.player_id] ?? ""} disabled={busy} onChange={(event) => updatePrivateNote(currentReview.player_id, event.target.value)} placeholder={t("coachDebrief.privateNotePlaceholder")} maxLength={4000} rows={4} />
                        <span className={styles.characterCount}>{String(privateNotes[currentReview.player_id] ?? "").length}/4 000</span>
                      </label>

                      {assistanceEnabled ? (
                        <button type="button" className={styles.cardAiAction} disabled={busy || currentPrivateAi.analyzing || !String(privateNotes[currentReview.player_id] ?? "").trim()} onClick={() => void analyzeCurrentPrivateNote()}>
                          <Sparkles size={17} aria-hidden="true" />{currentPrivateAi.analyzing ? t("coachDebrief.analyzing") : t("coachDebrief.analyzeActivitee")}
                        </button>
                      ) : null}

                      {assistanceEnabled && currentPrivateAi.proposal ? (
                        <div className={`${styles.individualProposal} ${currentPrivateAi.approved ? styles.proposalApproved : ""}`}>
                          <label>
                            <span>{t("coachDebrief.privateProposalLabel")}</span>
                            <small>{t("coachDebrief.privateProposalHelp")}</small>
                            <textarea value={currentPrivateAi.proposal.text} disabled={busy} maxLength={4000} rows={4} onChange={(event) => patchPrivateNoteAi(currentReview.player_id, { approved: false, success: null, proposal: currentPrivateAi.proposal ? { ...currentPrivateAi.proposal, text: event.target.value } : null })} />
                          </label>
                          <button type="button" className={styles.validatePlayerAction} disabled={busy || currentPrivateAi.approved || !currentPrivateAi.proposal.text.trim()} onClick={approveCurrentPrivateProposal}>
                            <Check size={16} aria-hidden="true" />{currentPrivateAi.approved ? t("coachDebrief.proposalApprovedShort") : t("coachDebrief.validateIndividual")}
                          </button>
                        </div>
                      ) : null}
                      </div>
                    </div>
                </section>
              ) : null}
            </div>

              <div className={styles.workflowActions}>
                <button type="button" className={styles.secondaryAction} disabled={busy || currentIndex === 0} onClick={() => { setCurrentIndex((index) => Math.max(0, index - 1)); setError(null); setMessage(null); }}>
                  <ChevronLeft size={18} aria-hidden="true" />{t("coachDebrief.previousPlayer")}
                </button>
                <button type="button" className={styles.primaryAction} disabled={busy || currentAi.analyzing || currentPrivateAi.analyzing} onClick={() => void saveCurrentEvaluation()}>
                  {busy ? t("coachDebrief.saving") : currentIndex === reviews.length - 1 ? t("coachDebrief.saveAndFinish") : t("coachDebrief.saveAndNext")}
                  {!busy ? <ChevronRight size={18} aria-hidden="true" /> : null}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
