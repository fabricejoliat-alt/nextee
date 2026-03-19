"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";

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
      setNonPerformanceDuration(typeof sess.total_minutes === "number" && sess.total_minutes > 0 ? String(sess.total_minutes) : "");
      if (sess.club_event_id) {
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

    router.push("/player/golf/trainings");
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("trainingEdit.title")}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                {t("common.back")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                {t("trainings.title")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}

          {sessionType === "club" && clubIds.length === 0 && !loading && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>
              {t("trainingNew.noActiveClub")}
            </div>
          )}
        </div>

        {/* Form */}
        <div className="glass-section">
          {loading ? (
            <CompactLoadingBlock label={t("common.loading")} />
          ) : (
            <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
              <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)", padding: 12, display: "grid", gap: 10 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {pickLocaleText(locale, "Date, lieu et type d'entraînement", "Date, place and training type")}
                </div>
                {attendanceBlocked ? (
                  <div
                    style={{
                      border: "1px solid rgba(239,68,68,0.18)",
                      background: "rgba(239,68,68,0.08)",
                      color: "rgba(127,29,29,1)",
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontSize: 12,
                      fontWeight: 900,
                    }}
                  >
                    {pickLocaleText(
                      locale,
                      "Tu es indiqué absent sur cet entraînement. L'évaluation joueur est désactivée.",
                      "You are marked absent for this training. Player evaluation is disabled."
                    )}
                  </div>
                ) : null}

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("roundsNew.dateTime")}</span>
                    <input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      disabled={busy || isCoachPlannedTraining}
                    />
                  </label>

                  {performanceEnabled ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{pickLocaleText(locale, "Total (min)", "Total (min)")}</span>
                      <div
                        style={{
                          height: 42,
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: "rgba(255,255,255,0.65)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0 12px",
                          fontWeight: 950,
                          color: "rgba(0,0,0,0.78)",
                        }}
                      >
                        <span>{effectiveTotalMinutes}</span>
                        <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>min</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{pickLocaleText(locale, "Durée (min)", "Duration (min)")}</span>
                      {isCoachPlannedTraining && sessionType === "club" ? (
                        <div
                          style={{
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.70)",
                            padding: "10px 12px",
                            fontSize: 13,
                            fontWeight: 900,
                            color: "rgba(0,0,0,0.80)",
                          }}
                        >
                          {effectiveTotalMinutes > 0 ? `${effectiveTotalMinutes} min` : "—"}
                        </div>
                      ) : (
                        <select
                          value={nonPerformanceDuration}
                          onChange={(e) => setNonPerformanceDuration(e.target.value)}
                          disabled={busy}
                          required
                        >
                          <option value="">{pickLocaleText(locale, "Veuillez sélectionner", "Please select")}</option>
                          {MINUTE_OPTIONS.map((m) => (
                            <option key={`edit-non-perf-duration-${m}`} value={String(m)}>
                              {m} min
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>{t("common.place")} ({t("common.optional")})</span>
                  <input
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    disabled={busy || isCoachPlannedTraining}
                    placeholder={t("trainingNew.placePlaceholder")}
                  />
                </label>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>{t("trainingNew.trainingType")}</div>
                  <select
                    value={sessionType}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!next) return;
                      setType(next as SessionType);
                    }}
                    disabled={busy || isCoachPlannedTraining}
                    required
                  >
                    <option value="">{pickLocaleText(locale, "Veuillez sélectionner", "Please select")}</option>
                    {sessionType === "club" ? (
                      <option value="club" disabled>
                        {pickLocaleText(locale, "Entraînement club (planifié)", "Club training (planned)")}
                      </option>
                    ) : null}
                    <option value="private">{t("trainingDetail.typePrivate")}</option>
                    <option value="individual">{t("trainingDetail.typeIndividual")}</option>
                  </select>

                  {sessionType === "club" && (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("common.club")}</span>
                      <select
                        value={clubIdForTraining}
                        onChange={(e) => setClubIdForTraining(e.target.value)}
                        disabled={busy || clubIds.length === 0 || isCoachPlannedTraining}
                      >
                        <option value="">-</option>
                        {clubIds.map((id) => (
                          <option key={id} value={id}>
                            {clubsById[id]?.name ?? id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {sessionType !== "individual" ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{pickLocaleText(locale, "Coach", "Coach")}</span>
                      <input
                        value={coachName}
                        onChange={(e) => setCoachName(e.target.value)}
                        disabled
                        placeholder={pickLocaleText(locale, "Coach (non modifiable ici)", "Coach (read-only here)")}
                      />
                    </label>
                  ) : null}

                  {!performanceEnabled ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{pickLocaleText(locale, "Notes / remarques", "Notes / remarks")} ({t("common.optional")})</span>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={busy}
                        placeholder={t("roundsNew.notesPlaceholder")}
                        style={{ minHeight: 90 }}
                      />
                    </label>
                  ) : null}
                </div>
              </div>

              {performanceEnabled && isCoachPlannedTraining ? (
              <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)", padding: 12, display: "grid", gap: 10 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {pickLocaleText(locale, "Structure planifiée", "Planned structure")}
                </div>
                <div
                  style={{
                    border: "1px solid rgba(0,0,0,0.10)",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.88)",
                    padding: 10,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {plannedStructureItems.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {pickLocaleText(locale, "Non saisi.", "Not entered.")}
                    </div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                      {plannedStructureItems.map((it, idx) => {
                        const label = TRAINING_CATEGORIES.find((c) => c.value === it.category)?.label ?? it.category;
                        const extra = String(it.note ?? "").trim();
                        return (
                          <li key={`planned-struct-edit-${idx}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                            {label} — {it.minutes} min
                            {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
              ) : null}

              {performanceEnabled ? (
              <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)", padding: 12, display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("trainingNew.trainingStructure")}</div>
                  {plannedStructureItems.length > 0 ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={copyPlannedStructure}
                      disabled={busy}
                      style={{ minHeight: 34, fontWeight: 900 }}
                    >
                      {pickLocaleText(locale, "Copier la structure planifiée", "Copy planned structure")}
                    </button>
                  ) : null}
                </div>

                {items.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("trainingNew.addSectionHint")}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {items.map((it, idx) => (
                      <div
                        key={idx}
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.65)",
                          padding: 12,
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        <div className="grid-2">
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("trainingNew.section")}</span>
                            <select
                              value={it.category}
                              onChange={(e) => updateLine(idx, { category: e.target.value })}
                              disabled={busy}
                            >
                              <option value="">-</option>
                              {TRAINING_CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("trainingNew.duration")}</span>
                            <select
                              value={it.minutes}
                              onChange={(e) => updateLine(idx, { minutes: e.target.value })}
                              disabled={busy}
                            >
                              <option value="">-</option>
                              {MINUTE_OPTIONS.map((m) => (
                                <option key={m} value={String(m)}>
                                  {m} min
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{t("trainingNew.noteOptional")}</span>
                          <input
                            value={it.note}
                            onChange={(e) => updateLine(idx, { note: e.target.value })}
                            disabled={busy}
                            placeholder={t("trainingNew.notePlaceholder")}
                          />
                        </label>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <div className="pill-soft">{t("trainingNew.section")} {idx + 1}</div>

                          <button
                            type="button"
                            className="btn btn-danger soft"
                            onClick={() => removeLine(idx)}
                            disabled={busy}
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" onClick={addLine} disabled={busy}>
                    + {t("trainingNew.addSection")}
                  </button>
                </div>
              </div>
              ) : null}

              {performanceEnabled ? (
              <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)", padding: 12, display: "grid", gap: 10 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {pickLocaleText(locale, "Sensations et remarques", "Feelings and notes")}
                </div>

                <div style={{ display: "grid", gap: 10, opacity: evaluationDisabled ? 0.65 : 1 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("trainingNew.motivationBefore")}</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                        const val = String(v);
                        const active = motivation === val;
                        return (
                          <button
                            key={`mot-${v}`}
                            type="button"
                            onClick={() => setMotivation((prev) => (prev === val ? "" : val))}
                            disabled={evaluationDisabled}
                            aria-pressed={active}
                            style={{
                              width: "100%",
                              height: 34,
                              borderRadius: 10,
                              border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                              background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                              color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                              fontWeight: 900,
                              cursor: evaluationDisabled ? "not-allowed" : "pointer",
                            }}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("trainingNew.difficultyDuring")}</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                        const val = String(v);
                        const active = difficulty === val;
                        return (
                          <button
                            key={`dif-${v}`}
                            type="button"
                            onClick={() => setDifficulty((prev) => (prev === val ? "" : val))}
                            disabled={evaluationDisabled}
                            aria-pressed={active}
                            style={{
                              width: "100%",
                              height: 34,
                              borderRadius: 10,
                              border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                              background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                              color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                              fontWeight: 900,
                              cursor: evaluationDisabled ? "not-allowed" : "pointer",
                            }}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("trainingNew.satisfactionAfter")}</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                        const val = String(v);
                        const active = satisfaction === val;
                        return (
                          <button
                            key={`sat-${v}`}
                            type="button"
                            onClick={() => setSatisfaction((prev) => (prev === val ? "" : val))}
                            disabled={evaluationDisabled}
                            aria-pressed={active}
                            style={{
                              width: "100%",
                              height: 34,
                              borderRadius: 10,
                              border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                              background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                              color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                              fontWeight: 900,
                              cursor: evaluationDisabled ? "not-allowed" : "pointer",
                            }}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                  </label>
                </div>

                {sessionType === "club" && !isClubSessionPast ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                    {locale === "fr"
                      ? "L'evaluation est disponible uniquement apres la seance."
                      : "Evaluation is available only after the training session."}
                  </div>
                ) : null}

                <label style={{ display: "grid", gap: 6, opacity: evaluationDisabled ? 0.65 : 1 }}>
                  <span style={fieldLabelStyle}>{t("roundsNew.notesOptional")}</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={evaluationDisabled}
                    placeholder={t("roundsNew.notesPlaceholder")}
                    style={{ minHeight: 110 }}
                  />
                </label>

                <button className="cta-green" type="submit" disabled={!canSave || busy} style={{ width: "100%" }}>
                  {busy ? t("trainingNew.saving") : t("common.save")}
                </button>
              </div>
              ) : (
                <button className="cta-green" type="submit" disabled={!canSave || busy} style={{ width: "100%" }}>
                  {busy ? t("trainingNew.saving") : nonPerformanceSaveLabel}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};
