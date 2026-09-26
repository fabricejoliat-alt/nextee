"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import TrainingPageSkeleton from "@/components/player/TrainingPageSkeleton";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import EvaluationResponseField from "@/components/evaluations/EvaluationResponseField";
import {
  DifficultyIcon,
  EvaluationIconBadge,
  MotivationIcon,
  SatisfactionIcon,
} from "@/components/evaluations/StandardEvaluationIcons";
import { validateResponseValue, type EventEvaluationCriterion } from "@/lib/evaluationCriteria";
import { ArrowLeft, Copy, Plus, Trash2 } from "lucide-react";
import playerUiStyles from "@/components/player/PlayerUI.module.css";
import styles from "./PlayerTrainingEdit.module.css";

type SessionType = "club" | "private" | "individual";

type TrainingItemDraft = {
  category: string; // enum value (snake_case)
  minutes: string; // store as string for select
  note: string;
};

type ClubRow = { id: string; name: string | null };
type ClubMemberRow = { club_id: string };

type SessionDbRow = {
  id: string;
  user_id: string;
  start_at: string;
  location_text: string | null;
  session_type: SessionType;
  club_id: string | null;
  coach_name: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number | null;
  club_event_id?: string | null;
};

type ItemDbRow = {
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  created_at?: string;
};

type EventStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position?: number | null;
};

// ✅ enum values from DB + nice labels
const TRAINING_CATEGORY_VALUES = [
  "warmup_mobility",
  "long_game",
  "short_game_all",
  "putting",
  "wedging",
  "pitching",
  "chipping",
  "bunker",
  "course",
  "mental",
  "fitness",
  "other",
] as const;

function buildMinuteOptions() {
  const opts: number[] = [];
  for (let m = 5; m <= 300; m += 5) opts.push(m);
  return opts;
}
const MINUTE_OPTIONS = buildMinuteOptions();

function toLocalDateTimeInputValue(iso: string) {
  // Convert ISO -> "YYYY-MM-DDTHH:mm" for datetime-local (local timezone)
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export default function PlayerTrainingEditPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = String(params?.sessionId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [performanceEnabled, setPerformanceEnabled] = useState(false);
  const [nowTs, setNowTs] = useState<number>(() => new Date().getTime());

  const [userId, setUserId] = useState("");

  // clubs
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [clubsById, setClubsById] = useState<Record<string, ClubRow>>({});
  const [clubIdForTraining, setClubIdForTraining] = useState<string>("");

  // fields
  const [startAt, setStartAt] = useState<string>("");
  const [place, setPlace] = useState<string>("");
  const [sessionType, setSessionType] = useState<SessionType>("club");
  const [coachName, setCoachName] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isCoachPlannedTraining, setIsCoachPlannedTraining] = useState(false);
  const [linkedEventDurationMinutes, setLinkedEventDurationMinutes] = useState<number | null>(null);
  const [nonPerformanceDuration, setNonPerformanceDuration] = useState<string>("");
  const [attendanceStatus, setAttendanceStatus] = useState<"expected" | "present" | "absent" | "excused" | null>(null);
  const [linkedEventId, setLinkedEventId] = useState("");
  const [customCriteria, setCustomCriteria] = useState<EventEvaluationCriterion[]>([]);
  const [customResponses, setCustomResponses] = useState<Record<string, string | number | boolean | null>>({});

  // sensations 1..6
  const [motivation, setMotivation] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [satisfaction, setSatisfaction] = useState<string>("");

  // items
  const [items, setItems] = useState<TrainingItemDraft[]>([]);
  const [plannedStructureItems, setPlannedStructureItems] = useState<EventStructureItemRow[]>([]);

  const normalizedSessionType: SessionType = isCoachPlannedTraining ? "club" : sessionType;

  const TRAINING_CATEGORIES: { value: string; label: string }[] = useMemo(
    () => TRAINING_CATEGORY_VALUES.map((value) => ({ value, label: t(`cat.${value}`) })),
    [t]
  );

  const totalMinutes = useMemo(() => {
    return items.reduce((sum, it) => {
      const v = Number(it.minutes);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }, [items]);

  const effectiveTotalMinutes = useMemo(() => {
    if (performanceEnabled) return totalMinutes;
    if (isCoachPlannedTraining && normalizedSessionType === "club") {
      const planned = Number(linkedEventDurationMinutes);
      if (Number.isFinite(planned) && planned > 0) return Math.round(planned);
    }
    const v = Number(nonPerformanceDuration);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return Math.round(v);
  }, [performanceEnabled, totalMinutes, nonPerformanceDuration, isCoachPlannedTraining, normalizedSessionType, linkedEventDurationMinutes]);

  const nonPerformanceSaveLabel = useMemo(
    () =>
      pickLocaleText(
        locale,
        "Enregistrer l'entraînement",
        "Save training"
      ),
    [locale]
  );

  const isClubSessionPast = useMemo(() => {
    if (normalizedSessionType !== "club") return true;
    if (!startAt) return false;
    const dt = new Date(startAt);
    if (Number.isNaN(dt.getTime())) return false;
    return dt.getTime() < nowTs;
  }, [normalizedSessionType, startAt, nowTs]);
  const attendanceBlocked = attendanceStatus === "absent" || attendanceStatus === "excused";

  const evaluationDisabled = busy || !isClubSessionPast || !performanceEnabled || attendanceBlocked;

  const canSave = useMemo(() => {
    if (busy) return false;
    if (attendanceBlocked) return false;
    if (!userId) return false;
    if (!sessionId) return false;
    if (!startAt) return false;

    if (normalizedSessionType === "club" && !clubIdForTraining && !isCoachPlannedTraining) return false;

    if (!performanceEnabled) {
      if (isCoachPlannedTraining && normalizedSessionType === "club") return effectiveTotalMinutes > 0;
      const v = Number(nonPerformanceDuration);
      return Number.isFinite(v) && v > 0;
    }

    const hasValidLine = items.some((it) => it.category && Number(it.minutes) > 0);
    if (!hasValidLine) return false;

    for (const it of items) {
      if (!it.category) return false;
      if (!it.minutes.trim()) return false;
      const v = Number(it.minutes);
      if (!Number.isFinite(v) || v <= 0 || v > 300) return false;
      if (v % 5 !== 0) return false;
    }

    return true;
  }, [busy, attendanceBlocked, performanceEnabled, nonPerformanceDuration, isCoachPlannedTraining, effectiveTotalMinutes, userId, sessionId, startAt, normalizedSessionType, clubIdForTraining, items]);

  useEffect(() => {
    const timer = setInterval(() => setNowTs(new Date().getTime()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      if (!sessionId) {
        setError(t("trainingDetail.error.missingId"));
        setLoading(false);
        return;
      }

      const { effectiveUserId: uid } = await resolveEffectivePlayerContext();
      setUserId(uid);
      const perfEnabled = await isEffectivePlayerPerformanceEnabled(uid);
      setPerformanceEnabled(perfEnabled);

      // 1) load memberships + clubs
      const memRes = await supabase
        .from("club_members")
        .select("club_id")
        .eq("user_id", uid)
        .eq("is_active", true);

      if (memRes.error) {
        setError(memRes.error.message);
        setLoading(false);
        return;
      }

      const ids = Array.from(new Set((memRes.data ?? []).map((r: ClubMemberRow) => r.club_id))).filter(Boolean);
      setClubIds(ids);

      if (ids.length > 0) {
        const clubsRes = await supabase.from("clubs").select("id,name").in("id", ids);
        if (clubsRes.error) {
          setError(clubsRes.error.message);
          setLoading(false);
          return;
        }

        const map: Record<string, ClubRow> = {};
        for (const c of clubsRes.data ?? []) map[c.id] = c as ClubRow;
        setClubsById(map);
      } else {
        setClubsById({});
      }

      // 2) load session
      const sRes = await supabase
        .from("training_sessions")
        .select(
          "id,user_id,start_at,location_text,session_type,club_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,club_event_id"
        )
        .eq("id", sessionId)
        .maybeSingle();

      if (sRes.error) {
        setError(sRes.error.message);
        setLoading(false);
        return;
      }
      const sess = (sRes.data ?? null) as SessionDbRow | null;
      if (!sess) {
        setError(t("trainingDetail.error.notFound"));
        setLoading(false);
        return;
      }

      // Optionnel: si tu veux une protection “soft” côté UI
      if (sess.user_id && sess.user_id !== uid) {
        setError(t("trainingEdit.error.forbidden"));
        setLoading(false);
        return;
      }

      setStartAt(toLocalDateTimeInputValue(sess.start_at));
      setPlace((sess.location_text ?? "") as string);
      setSessionType(sess.club_event_id ? "club" : sess.session_type);

      setCoachName((sess.coach_name ?? "") as string);
      setNotes((sess.notes ?? "") as string);

      setMotivation(typeof sess.motivation === "number" ? String(sess.motivation) : "");
      setDifficulty(typeof sess.difficulty === "number" ? String(sess.difficulty) : "");
      setSatisfaction(typeof sess.satisfaction === "number" ? String(sess.satisfaction) : "");
      setIsCoachPlannedTraining(Boolean(sess.club_event_id));
      setLinkedEventId(String(sess.club_event_id ?? ""));
      setNonPerformanceDuration(typeof sess.total_minutes === "number" && sess.total_minutes > 0 ? String(sess.total_minutes) : "");
      if (sess.club_event_id) {
        const { data: authData } = await supabase.auth.getSession();
        const query = new URLSearchParams({ event_id: sess.club_event_id, child_id: uid });
        const eventResponse = await fetch(`/api/player/training-event?${query.toString()}`, {
          headers: authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {},
          cache: "no-store",
        });
        const eventJson = await eventResponse.json().catch(() => ({}));
        if (!eventResponse.ok) {
          setError(String(eventJson?.error ?? t("common.errorLoading")));
          setLoading(false);
          return;
        }
        setCustomCriteria((eventJson?.customEvaluationCriteria ?? []) as EventEvaluationCriterion[]);
        setCustomResponses(Object.fromEntries(((eventJson?.customEvaluationResponses ?? []) as Array<{ event_criterion_id: string; value_json: string | number | boolean | null }>).map((row) => [row.event_criterion_id, row.value_json])));
        const attRes = await supabase
          .from("club_event_attendees")
          .select("status")
          .eq("event_id", sess.club_event_id)
          .eq("player_id", uid)
          .maybeSingle();
        if (!attRes.error) {
          setAttendanceStatus((attRes.data?.status ?? null) as "expected" | "present" | "absent" | "excused" | null);
        } else {
          setAttendanceStatus(null);
        }
        const evRes = await supabase
          .from("club_events")
          .select("duration_minutes")
          .eq("id", sess.club_event_id)
          .maybeSingle();
        if (!evRes.error && evRes.data) {
          const planned = Number(evRes.data.duration_minutes);
          setLinkedEventDurationMinutes(Number.isFinite(planned) && planned > 0 ? planned : null);
        } else {
          setLinkedEventDurationMinutes(null);
        }

        const playerStructRes = await supabase
          .from("club_event_player_structure_items")
          .select("category,minutes,note,position")
          .eq("event_id", sess.club_event_id)
          .eq("player_id", uid)
          .order("position", { ascending: true });
        if (!playerStructRes.error && (playerStructRes.data ?? []).length > 0) {
          setPlannedStructureItems((playerStructRes.data ?? []) as EventStructureItemRow[]);
        } else {
          const eventStructRes = await supabase
            .from("club_event_structure_items")
            .select("category,minutes,note,position")
            .eq("event_id", sess.club_event_id)
            .order("position", { ascending: true });
          if (!eventStructRes.error) {
            setPlannedStructureItems((eventStructRes.data ?? []) as EventStructureItemRow[]);
          } else {
            setPlannedStructureItems([]);
          }
        }
      } else {
        setCustomCriteria([]);
        setCustomResponses({});
        setAttendanceStatus(null);
        setLinkedEventDurationMinutes(null);
        setPlannedStructureItems([]);
      }

      const cid = (sess.club_event_id ? "club" : sess.session_type) === "club" ? (sess.club_id ?? "") : "";
      if ((sess.club_event_id ? "club" : sess.session_type) === "club") {
        // si club_id présent, on le garde; sinon fallback = premier club actif
        if (cid) setClubIdForTraining(cid);
        else if (ids.length > 0) setClubIdForTraining(ids[0]);
        else setClubIdForTraining("");
      } else {
        setClubIdForTraining("");
      }

      // 3) load items
      const itRes = await supabase
        .from("training_session_items")
        .select("session_id,category,minutes,note,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (itRes.error) {
        setError(itRes.error.message);
        setLoading(false);
        return;
      }

      const draft: TrainingItemDraft[] = (itRes.data ?? []).map((r: ItemDbRow) => ({
        category: r.category ?? "",
        minutes: r.minutes != null ? String(r.minutes) : "",
        note: (r.note ?? "") as string,
      }));

      setItems(draft.length > 0 ? draft : []);
      setLoading(false);
    })();
  }, [sessionId, t, locale]);

  function addLine() {
    setItems((prev) => [...prev, { category: "", minutes: "", note: "" }]);
  }

  function removeLine(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<TrainingItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function copyPlannedStructure() {
    if (busy || plannedStructureItems.length === 0) return;
    setItems(
      plannedStructureItems.map((it) => ({
        category: String(it.category ?? ""),
        minutes: String(it.minutes ?? ""),
        note: String(it.note ?? "").trim(),
      }))
    );
  }

  function setType(next: SessionType) {
    setSessionType(next);
    if (next === "club") {
      if (!clubIdForTraining && clubIds.length > 0) setClubIdForTraining(clubIds[0]);
    } else {
      setClubIdForTraining("");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setBusy(true);
    setError(null);

    const dt = new Date(startAt);
    if (Number.isNaN(dt.getTime())) {
      setError(t("roundsNew.error.invalidDate"));
      setBusy(false);
      return;
    }
    if (attendanceBlocked) {
      setError(
        pickLocaleText(
          locale,
          "Tu ne peux pas évaluer cet entraînement car ton statut est absent.",
          "You cannot evaluate this training because your attendance status is absent."
        )
      );
      setBusy(false);
      return;
    }

    const mot = performanceEnabled && motivation ? Number(motivation) : null;
    const dif = performanceEnabled && difficulty ? Number(difficulty) : null;
    const sat = performanceEnabled && satisfaction ? Number(satisfaction) : null;

    const club_id = normalizedSessionType === "club" ? clubIdForTraining : null;

    if (performanceEnabled && linkedEventId) {
      const missing = customCriteria.find((criterion) => criterion.snapshot_is_required && !validateResponseValue(criterion.snapshot_response_format, criterion.snapshot_choices, customResponses[criterion.id]));
      if (missing) {
        setError(pickLocaleText(locale, `Le critère « ${missing.snapshot_name} » est obligatoire.`, `“${missing.snapshot_name}” is required.`));
        setBusy(false);
        return;
      }
    }

    // 1) update session
    const upd = await supabase
      .from("training_sessions")
      .update({
        start_at: dt.toISOString(),
        location_text: place.trim() || null,
        session_type: sessionType,
        club_id,
        coach_name: isCoachPlannedTraining ? coachName || null : coachName.trim() || null,
        motivation: mot,
        difficulty: dif,
        satisfaction: sat,
        notes: notes.trim() || null,
        total_minutes: effectiveTotalMinutes > 0 ? effectiveTotalMinutes : null,
      })
      .eq("id", sessionId);

    if (upd.error) {
      setError(upd.error.message);
      setBusy(false);
      return;
    }

    // 2) replace items only for performance players
    if (performanceEnabled) {
      const delItems = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
      if (delItems.error) {
        setError(delItems.error.message);
        setBusy(false);
        return;
      }

      const payload = items.map((it) => ({
        session_id: sessionId,
        category: it.category,
        minutes: Number(it.minutes),
        note: it.note.trim() || null,
      }));

      if (payload.length > 0) {
        const ins = await supabase.from("training_session_items").insert(payload);
        if (ins.error) {
          setError(ins.error.message);
          setBusy(false);
          return;
        }
      }
    }

    if (performanceEnabled && linkedEventId && customCriteria.length > 0) {
      const clearedIds = customCriteria.filter((criterion) => customResponses[criterion.id] == null || customResponses[criterion.id] === "").map((criterion) => criterion.id);
      if (clearedIds.length > 0) {
        const removed = await supabase.from("club_event_evaluation_responses").delete().eq("event_id", linkedEventId).eq("player_id", userId).eq("respondent_role", "player").in("event_criterion_id", clearedIds);
        if (removed.error) { setError(removed.error.message); setBusy(false); return; }
      }
      const answered = customCriteria.filter((criterion) => customResponses[criterion.id] != null && customResponses[criterion.id] !== "");
      if (answered.length > 0) {
        const saved = await supabase.from("club_event_evaluation_responses").upsert(answered.map((criterion) => ({
          club_id: clubIdForTraining,
          event_criterion_id: criterion.id,
          event_id: linkedEventId,
          player_id: userId,
          respondent_user_id: userId,
          respondent_role: "player",
          value_json: customResponses[criterion.id],
        })), { onConflict: "event_criterion_id,player_id,respondent_role" });
        if (saved.error) { setError(saved.error.message); setBusy(false); return; }
      }
    }

    router.push("/player/golf/trainings");
  }

  return (
    <div className={["player-dashboard-bg", styles.pageBackground].join(" ")}>
      <div className={["app-shell", "marketplace-page", styles.shell].join(" ")}>
        <PlayerBreadcrumb
          items={[
            { label: "Player", href: "/player" },
            { label: pickLocaleText(locale, "Mes activités", "My activities"), href: "/player/golf/trainings" },
            { label: pickLocaleText(locale, "Modifier l’activité", "Edit activity") },
          ]}
        />

        <header className={styles.hero}>
          <div>
            <h1>{pickLocaleText(locale, "Modifier l’activité", "Edit activity")}</h1>
            <p>{pickLocaleText(locale, "Mets à jour la structure réalisée et ton auto-évaluation.", "Update the completed structure and your self-assessment.")}</p>
          </div>
          <Link className={playerUiStyles.secondary} href={"/player/golf/trainings/" + sessionId}>
            <ArrowLeft size={15} aria-hidden="true" />
            {pickLocaleText(locale, "Retour à l’activité", "Back to activity")}
          </Link>
        </header>

        {error ? <div className={playerUiStyles.alertError}>{error}</div> : null}

        {loading ? (
          <TrainingPageSkeleton variant="form" label={t("common.loading")} />
        ) : (
          <form onSubmit={save} className={styles.form}>
            <section className={playerUiStyles.panel}>
              <EditSectionHeader
                title={pickLocaleText(locale, "Informations de l’activité", "Activity information")}
                description={pickLocaleText(locale, "Date, lieu, durée et encadrement.", "Date, place, duration and coaching.")}
              />

              {attendanceBlocked ? (
                <div className={styles.warning}>
                  {pickLocaleText(
                    locale,
                    "Tu es indiqué absent ou excusé sur cet entraînement. L’évaluation joueur est désactivée.",
                    "You are marked absent or excused for this training. Player evaluation is disabled."
                  )}
                </div>
              ) : null}

              {sessionType === "club" && clubIds.length === 0 ? (
                <div className={styles.warning}>{t("trainingNew.noActiveClub")}</div>
              ) : null}

              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span>{t("roundsNew.dateTime")}</span>
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(event) => setStartAt(event.target.value)}
                    disabled={busy || isCoachPlannedTraining}
                  />
                </label>

                <div className={styles.field}>
                  <span>{performanceEnabled ? pickLocaleText(locale, "Total réalisé", "Completed total") : pickLocaleText(locale, "Durée", "Duration")}</span>
                  {performanceEnabled || (isCoachPlannedTraining && sessionType === "club") ? (
                    <div className={styles.readOnlyValue}>
                      <strong>{effectiveTotalMinutes > 0 ? effectiveTotalMinutes : "—"}</strong>
                      <small>min</small>
                    </div>
                  ) : (
                    <select
                      value={nonPerformanceDuration}
                      onChange={(event) => setNonPerformanceDuration(event.target.value)}
                      disabled={busy}
                      required
                    >
                      <option value="">{pickLocaleText(locale, "Veuillez sélectionner", "Please select")}</option>
                      {MINUTE_OPTIONS.map((minutes) => (
                        <option key={"edit-duration-" + minutes} value={String(minutes)}>{minutes} min</option>
                      ))}
                    </select>
                  )}
                </div>

                <label className={styles.field}>
                  <span>{t("common.place")} <small>({t("common.optional")})</small></span>
                  <input
                    value={place}
                    onChange={(event) => setPlace(event.target.value)}
                    disabled={busy || isCoachPlannedTraining}
                    placeholder={t("trainingNew.placePlaceholder")}
                  />
                </label>

                <label className={styles.field}>
                  <span>{t("trainingNew.trainingType")}</span>
                  <select
                    value={sessionType}
                    onChange={(event) => {
                      if (event.target.value) setType(event.target.value as SessionType);
                    }}
                    disabled={busy || isCoachPlannedTraining}
                    required
                  >
                    {sessionType === "club" ? (
                      <option value="club">{pickLocaleText(locale, "Entraînement club", "Club training")}</option>
                    ) : null}
                    <option value="private">{t("trainingDetail.typePrivate")}</option>
                    <option value="individual">{t("trainingDetail.typeIndividual")}</option>
                  </select>
                </label>

                {sessionType === "club" ? (
                  <label className={styles.field}>
                    <span>{t("common.club")}</span>
                    <select
                      value={clubIdForTraining}
                      onChange={(event) => setClubIdForTraining(event.target.value)}
                      disabled={busy || clubIds.length === 0 || isCoachPlannedTraining}
                    >
                      <option value="">—</option>
                      {clubIds.map((id) => (
                        <option key={id} value={id}>{clubsById[id]?.name ?? id}</option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {sessionType !== "individual" ? (
                  <label className={styles.field}>
                    <span>{pickLocaleText(locale, "Coach", "Coach")}</span>
                    <input
                      value={coachName}
                      onChange={(event) => setCoachName(event.target.value)}
                      disabled
                      placeholder={pickLocaleText(locale, "Coach non renseigné", "Coach not entered")}
                    />
                  </label>
                ) : null}
              </div>

              {!performanceEnabled ? (
                <label className={styles.field}>
                  <span>{pickLocaleText(locale, "Notes / remarques", "Notes / remarks")} <small>({t("common.optional")})</small></span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={busy}
                    placeholder={t("roundsNew.notesPlaceholder")}
                  />
                </label>
              ) : null}
            </section>

            {performanceEnabled && isCoachPlannedTraining ? (
              <section className={playerUiStyles.panel}>
                <EditSectionHeader
                  title={pickLocaleText(locale, "Structure planifiée", "Planned structure")}
                  description={pickLocaleText(locale, "Le programme préparé par le coach pour cette activité.", "The programme prepared by the coach for this activity.")}
                />
                {plannedStructureItems.length ? (
                  <div className={styles.plannedList}>
                    {plannedStructureItems.map((item, index) => {
                      const label = TRAINING_CATEGORIES.find((category) => category.value === item.category)?.label ?? item.category;
                      return (
                        <div className={styles.plannedItem} key={"planned-struct-edit-" + index}>
                          <div>
                            <strong>{label}</strong>
                            {item.note ? <small>{item.note}</small> : null}
                          </div>
                          <b>{item.minutes} min</b>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.empty}>{pickLocaleText(locale, "Aucun contenu planifié.", "No planned content.")}</div>
                )}
              </section>
            ) : null}

            {performanceEnabled ? (
              <section className={playerUiStyles.panel}>
                <EditSectionHeader
                  title={pickLocaleText(locale, "Structure réalisée", "Completed structure")}
                  description={pickLocaleText(locale, "Indique précisément les secteurs travaillés et leur durée.", "Enter the areas trained and their duration.")}
                  action={plannedStructureItems.length ? (
                    <button type="button" className={playerUiStyles.secondary} onClick={copyPlannedStructure} disabled={busy}>
                      <Copy size={14} aria-hidden="true" />
                      {pickLocaleText(locale, "Copier le plan", "Copy plan")}
                    </button>
                  ) : null}
                />

                {items.length ? (
                  <div className={styles.trainingItems}>
                    {items.map((item, index) => (
                      <div className={styles.trainingItem} key={index}>
                        <div className={styles.itemHeader}>
                          <strong>{t("trainingNew.section")} {index + 1}</strong>
                          <button
                            type="button"
                            className={[playerUiStyles.iconButton, playerUiStyles.dangerIcon].join(" ")}
                            onClick={() => removeLine(index)}
                            disabled={busy}
                            title={t("common.delete")}
                            aria-label={t("common.delete") + " — " + t("trainingNew.section") + " " + (index + 1)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                        <div className={styles.fieldGrid}>
                          <label className={styles.field}>
                            <span>{t("trainingNew.section")}</span>
                            <select
                              value={item.category}
                              onChange={(event) => updateLine(index, { category: event.target.value })}
                              disabled={busy}
                            >
                              <option value="">—</option>
                              {TRAINING_CATEGORIES.map((category) => (
                                <option key={category.value} value={category.value}>{category.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span>{t("trainingNew.duration")}</span>
                            <select
                              value={item.minutes}
                              onChange={(event) => updateLine(index, { minutes: event.target.value })}
                              disabled={busy}
                            >
                              <option value="">—</option>
                              {MINUTE_OPTIONS.map((minutes) => (
                                <option key={minutes} value={String(minutes)}>{minutes} min</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className={styles.field}>
                          <span>{t("trainingNew.noteOptional")}</span>
                          <input
                            value={item.note}
                            onChange={(event) => updateLine(index, { note: event.target.value })}
                            disabled={busy}
                            placeholder={t("trainingNew.notePlaceholder")}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>{t("trainingNew.addSectionHint")}</div>
                )}

                <div className={styles.sectionActions}>
                  <button type="button" className={playerUiStyles.secondary} onClick={addLine} disabled={busy}>
                    <Plus size={15} aria-hidden="true" />
                    {t("trainingNew.addSection")}
                  </button>
                </div>
              </section>
            ) : null}

            {performanceEnabled ? (
              <section className={playerUiStyles.panel}>
                <EditSectionHeader
                  title={pickLocaleText(locale, "Mon auto-évaluation", "My self-assessment")}
                  description={pickLocaleText(locale, "Évalue ton ressenti, puis complète les priorités définies par le club.", "Rate how you felt, then complete the priorities defined by the club.")}
                />

                <div className={styles.ratingGrid} data-disabled={evaluationDisabled}>
                  <RatingInput
                    label={t("trainingNew.motivationBefore")}
                    icon={<EvaluationIconBadge><MotivationIcon size={17} /></EvaluationIconBadge>}
                    value={motivation}
                    onChange={setMotivation}
                    disabled={evaluationDisabled}
                  />
                  <RatingInput
                    label={t("trainingNew.difficultyDuring")}
                    icon={<EvaluationIconBadge><DifficultyIcon size={17} /></EvaluationIconBadge>}
                    value={difficulty}
                    onChange={setDifficulty}
                    disabled={evaluationDisabled}
                  />
                  <RatingInput
                    label={t("trainingNew.satisfactionAfter")}
                    icon={<EvaluationIconBadge><SatisfactionIcon size={17} /></EvaluationIconBadge>}
                    value={satisfaction}
                    onChange={setSatisfaction}
                    disabled={evaluationDisabled}
                  />
                </div>

                {customCriteria.length ? (
                  <div className={styles.customCriteria} data-disabled={evaluationDisabled}>
                    <div className={styles.subsectionHeader}>
                      <strong>{pickLocaleText(locale, "Critères du club", "Club criteria")}</strong>
                      <small>{pickLocaleText(locale, "Ces priorités ont été définies pour cette activité.", "These priorities were defined for this activity.")}</small>
                    </div>
                    {customCriteria.map((criterion) => (
                      <label className={styles.field} key={criterion.id}>
                        <span>{criterion.snapshot_name}{criterion.snapshot_is_required ? " *" : ""}</span>
                        {criterion.snapshot_description ? <small className={styles.fieldDescription}>{criterion.snapshot_description}</small> : null}
                        <EvaluationResponseField
                          name={criterion.snapshot_name}
                          format={criterion.snapshot_response_format}
                          choices={criterion.snapshot_choices}
                          value={customResponses[criterion.id]}
                          disabled={evaluationDisabled}
                          onChange={(value) => setCustomResponses((current) => ({ ...current, [criterion.id]: value }))}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                {sessionType === "club" && !isClubSessionPast ? (
                  <div className={styles.info}>
                    {pickLocaleText(locale, "L’évaluation sera disponible après la séance.", "Evaluation will be available after the training session.")}
                  </div>
                ) : null}

                <label className={styles.field} data-disabled={evaluationDisabled}>
                  <span>{t("roundsNew.notesOptional")}</span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={evaluationDisabled}
                    placeholder={t("roundsNew.notesPlaceholder")}
                  />
                </label>
              </section>
            ) : null}

            <div className={styles.formActions}>
              <Link href={"/player/golf/trainings/" + sessionId} className={playerUiStyles.secondary}>
                {pickLocaleText(locale, "Annuler", "Cancel")}
              </Link>
              <button className={playerUiStyles.primary} type="submit" disabled={!canSave || busy}>
                {busy ? t("trainingNew.saving") : performanceEnabled ? pickLocaleText(locale, "Enregistrer les modifications", "Save changes") : nonPerformanceSaveLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function EditSectionHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function RatingInput({
  label,
  icon,
  value,
  onChange,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className={styles.ratingField} disabled={disabled}>
      <legend><span>{icon}</span>{label}</legend>
      <div className={styles.ratingButtons}>
        {Array.from({ length: 6 }, (_, index) => String(index + 1)).map((score) => {
          const active = value === score;
          return (
            <button
              key={score}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? "" : score)}
              className={active ? styles.ratingActive : undefined}
            >
              {score}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
