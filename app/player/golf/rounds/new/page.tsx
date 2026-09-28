"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { mapPlayerTransactionError } from "@/lib/playerTransactionErrors";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import styles from "./NewRound.module.css";

type ProfileRow = {
  handicap: number | null;
};
type PlayHolesMode = "9" | "18";
type ManualTeeColor = "white" | "yellow" | "blue" | "red";
type OmCompetitionLevel = "club_internal" | "club_official" | "regional" | "national" | "international";
type OmCompetitionLevelSelect = OmCompetitionLevel | "exceptional";
type OmCompetitionFormat = "stroke_play_individual" | "match_play_individual";
type ExceptionalTournamentRow = { id: string; name: string };
type OmMatchResult = "won" | "lost";
function manualTeeLabel(color: ManualTeeColor) {
  if (color === "white") return "Tee blanc";
  if (color === "yellow") return "Tee jaune";
  if (color === "blue") return "Tee bleu";
  return "Tee rouge";
}

function addDaysToYmd(ymd: string, days: number) {
  const base = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(base.getTime())) return ymd;
  base.setDate(base.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

export default function NewRoundPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startAt, setStartAt] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [multiRoundDates, setMultiRoundDates] = useState<string[]>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return [base, addDaysToYmd(base, 1), addDaysToYmd(base, 2), addDaysToYmd(base, 3)];
  });

  const [roundType, setRoundType] = useState<"training" | "competition">("training");
  const [competitionName, setCompetitionName] = useState("");
  const [handicapStart, setHandicapStart] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [omOrganizationId, setOmOrganizationId] = useState<string>("");
  const [omCompetitionLevel, setOmCompetitionLevel] = useState<OmCompetitionLevel>("club_official");
  const [omCompetitionLevelSelect, setOmCompetitionLevelSelect] = useState<OmCompetitionLevelSelect>("club_official");
  const [omCompetitionFormat, setOmCompetitionFormat] = useState<OmCompetitionFormat>("stroke_play_individual");
  const [omRounds18Count, setOmRounds18Count] = useState<1 | 2 | 3 | 4>(1);
  const [omSingleNine, setOmSingleNine] = useState(false);
  const [omScoreEntryMode, setOmScoreEntryMode] = useState<"full" | "hole_only">("full");
  const [omMatchResult, setOmMatchResult] = useState<OmMatchResult>("won");
  const [opponentHandicap, setOpponentHandicap] = useState<string>("");
  const [matchScoreText, setMatchScoreText] = useState<string>("");
  const [matchCourseName, setMatchCourseName] = useState<string>("");
  const [omIsExceptional, setOmIsExceptional] = useState(false);
  const [omExceptionalTournamentId, setOmExceptionalTournamentId] = useState<string>("");
  const [exceptionalTournaments, setExceptionalTournaments] = useState<ExceptionalTournamentRow[]>([]);

  const [manualLocation, setManualLocation] = useState("");
  const [manualTeeColor, setManualTeeColor] = useState<ManualTeeColor>("yellow");
  const [manualSlope, setManualSlope] = useState<string>("");
  const [manualCourseRating, setManualCourseRating] = useState<string>("");

  const [playHolesMode, setPlayHolesMode] = useState<PlayHolesMode>("18");
  const [inputMode, setInputMode] = useState<"guided" | "grid">("guided");

  useEffect(() => {
    (async () => {
      setError(null);

      const { effectiveUserId: uid } = await resolveEffectivePlayerContext();
      const profRes = await supabase.from("profiles").select("handicap").eq("id", uid).maybeSingle();
      if (profRes.error) {
        console.warn("profile handicap load failed:", profRes.error.message);
        return;
      }

      const h = (profRes.data as ProfileRow | null)?.handicap;
      if (typeof h === "number" && Number.isFinite(h)) {
        setHandicapStart((prev) => (prev.trim() ? prev : String(h)));
      }

      const cmRes = await supabase
        .from("club_members")
        .select("club_id")
        .eq("user_id", uid)
        .eq("is_active", true)
        .eq("role", "player")
        .limit(1)
        .maybeSingle();
      if (!cmRes.error && cmRes.data?.club_id) {
        setOmOrganizationId(String(cmRes.data.club_id));
      }
    })();
  }, []);

  const handicapValue = useMemo(() => {
    if (!handicapStart.trim()) return null;
    const v = Number(handicapStart);
    return Number.isFinite(v) ? v : null;
  }, [handicapStart]);

  const canUseExceptional = (handicapValue ?? Infinity) < 10;
  const isMatchPlayCompetition = roundType === "competition" && omCompetitionFormat === "match_play_individual";
  const isMultiRoundStrokePlay = roundType === "competition" && !isMatchPlayCompetition && omRounds18Count > 1;
  const isSingleNineCompetition = roundType === "competition" && !isMatchPlayCompetition && omSingleNine && omRounds18Count === 1;

  useEffect(() => {
    setMultiRoundDates((prev) => {
      const next = [...prev];
      next[0] = startAt;
      for (let i = 1; i < 4; i += 1) {
        if (!next[i]) next[i] = addDaysToYmd(startAt, i);
      }
      return next;
    });
  }, [startAt]);

  useEffect(() => {
    if (!canUseExceptional && (omIsExceptional || omCompetitionLevelSelect === "exceptional")) {
      setOmIsExceptional(false);
      setOmExceptionalTournamentId("");
      setOmCompetitionLevelSelect("club_official");
    }
  }, [canUseExceptional, omIsExceptional, omCompetitionLevelSelect]);

  useEffect(() => {
    if (omCompetitionLevelSelect === "exceptional") {
      setOmIsExceptional(true);
      return;
    }
    setOmIsExceptional(false);
    setOmExceptionalTournamentId("");
    setOmCompetitionLevel(omCompetitionLevelSelect);
  }, [omCompetitionLevelSelect]);

  useEffect(() => {
    if (!isMatchPlayCompetition) return;
    setOmIsExceptional(false);
    setOmExceptionalTournamentId("");
    setOmCompetitionLevelSelect("club_official");
    setOmSingleNine(false);
  }, [isMatchPlayCompetition]);

  useEffect(() => {
    if (roundType !== "competition" || !canUseExceptional || !omOrganizationId) {
      setExceptionalTournaments([]);
      setOmExceptionalTournamentId("");
      return;
    }

    (async () => {
      const res = await supabase
        .from("om_exceptional_tournaments")
        .select("id,name")
        .eq("organization_id", omOrganizationId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (res.error) {
        console.warn("exceptional tournaments load failed:", res.error.message);
        return;
      }
      setExceptionalTournaments((res.data ?? []) as ExceptionalTournamentRow[]);
    })();
  }, [roundType, canUseExceptional, omOrganizationId]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (!startAt) return false;

    const dt = new Date(`${startAt}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return false;

    if (roundType === "competition" && !competitionName.trim()) return false;
    if (roundType === "competition" && !omOrganizationId) return false;
    if (roundType === "competition" && !isMatchPlayCompetition && !omCompetitionLevel) return false;
    if (roundType === "competition" && !omCompetitionFormat) return false;
    if (roundType === "competition" && !(omRounds18Count >= 1 && omRounds18Count <= 4)) return false;
    if (roundType === "competition" && omCompetitionFormat !== "match_play_individual" && !omScoreEntryMode) return false;
    if (isMultiRoundStrokePlay) {
      for (let i = 0; i < omRounds18Count; i += 1) {
        const d = multiRoundDates[i] ?? "";
        if (!d) return false;
        const v = new Date(`${d}T00:00:00`);
        if (Number.isNaN(v.getTime())) return false;
      }
    }
    if (!isMatchPlayCompetition) {
      if (!manualLocation.trim()) return false;
    } else {
      if (!matchCourseName.trim()) return false;
      if (!matchScoreText.trim()) return false;
      if (!(omMatchResult === "won" || omMatchResult === "lost")) return false;
      if (opponentHandicap.trim()) {
        const oh = Number(opponentHandicap);
        if (!Number.isFinite(oh)) return false;
      }
    }

    if (handicapStart.trim()) {
      const v = Number(handicapStart);
      if (!Number.isFinite(v)) return false;
    }

    if (roundType === "competition") {
      if (omIsExceptional && !omExceptionalTournamentId) return false;
    }

    if (!isMatchPlayCompetition) {
      if (manualSlope.trim()) {
        const s = Number(manualSlope);
        if (!Number.isFinite(s)) return false;
      }
      if (manualCourseRating.trim()) {
        const cr = Number(manualCourseRating);
        if (!Number.isFinite(cr)) return false;
      }
    }

    // Competition requires CR/SR to compute OM.
    if (roundType === "competition" && !isMatchPlayCompetition) {
      if (manualSlope.trim() === "" || manualCourseRating.trim() === "") return false;
    }

    return true;
  }, [
    busy,
    startAt,
    roundType,
    competitionName,
    omOrganizationId,
    omCompetitionLevel,
    omCompetitionFormat,
    omRounds18Count,
    omIsExceptional,
    omExceptionalTournamentId,
    handicapStart,
    manualLocation,
    manualSlope,
    manualCourseRating,
    isMatchPlayCompetition,
    isMultiRoundStrokePlay,
    multiRoundDates,
    matchCourseName,
    matchScoreText,
    omMatchResult,
    opponentHandicap,
    omScoreEntryMode,
  ]);

  async function createRound(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setBusy(true);
    setError(null);

    const dt = new Date(`${startAt}T00:00:00`);
    if (Number.isNaN(dt.getTime())) {
      setError(t("roundsNew.error.invalidDate"));
      setBusy(false);
      return;
    }

    const { effectiveUserId: uid } = await resolveEffectivePlayerContext();

    if (!isMatchPlayCompetition && !manualLocation.trim()) {
      setError(t("roundsNew.error.chooseCourse"));
      setBusy(false);
      return;
    }

    const handicap_start = handicapStart.trim() === "" ? null : Number(handicapStart);
    if (handicap_start !== null && Number.isNaN(handicap_start)) {
      setError(t("roundsNew.error.invalidHandicap"));
      setBusy(false);
      return;
    }

    const slopeManual = !isMatchPlayCompetition && manualSlope.trim() !== "" ? Number(manualSlope) : null;
    const courseRatingManual = !isMatchPlayCompetition && manualCourseRating.trim() !== "" ? Number(manualCourseRating) : null;
    if (!isMatchPlayCompetition && slopeManual !== null && Number.isNaN(slopeManual)) {
      setError("Slope invalide");
      setBusy(false);
      return;
    }
    if (!isMatchPlayCompetition && courseRatingManual !== null && Number.isNaN(courseRatingManual)) {
      setError("Course Rating invalide");
      setBusy(false);
      return;
    }

    if (roundType === "competition") {
      if (!omOrganizationId) {
        setError(pickLocaleText(locale, "Organisation introuvable pour ce joueur.", "Organization not found for this player."));
        setBusy(false);
        return;
      }
      if (isMatchPlayCompetition && !matchCourseName.trim()) {
        setError(pickLocaleText(locale, "Le champ Parcours est obligatoire.", "Course field is required."));
        setBusy(false);
        return;
      }
      if (isMatchPlayCompetition && !matchScoreText.trim()) {
        setError(pickLocaleText(locale, "Le champ Score est obligatoire.", "Score field is required."));
        setBusy(false);
        return;
      }
      if (!isMatchPlayCompetition && (slopeManual == null || courseRatingManual == null)) {
        setError(
          pickLocaleText(
            locale,
            "Course Rating et Slope Rating sont obligatoires pour une competition.",
            "Course Rating and Slope Rating are required for a competition."
          )
        );
        setBusy(false);
        return;
      }
      if (omIsExceptional && !omExceptionalTournamentId) {
        setError(
          pickLocaleText(
            locale,
            "Selectionne un tournoi exceptionnel.",
            "Please select an exceptional tournament."
          )
        );
        setBusy(false);
        return;
      }
    }

    const parsedOpponentHandicap = opponentHandicap.trim() ? Number(opponentHandicap) : null;

    const payloadBase: Record<string, unknown> = {
      user_id: uid,
      location: isMatchPlayCompetition ? matchCourseName.trim() : manualLocation.trim(),
      round_type: roundType,
      competition_name: roundType === "competition" ? competitionName.trim() : null,
      handicap_start,
      course_source: "manual",
      course_name: isMatchPlayCompetition ? matchCourseName.trim() : manualLocation.trim(),
      external_course_id: null,
      tee_name: isMatchPlayCompetition ? null : manualTeeLabel(manualTeeColor),
      slope_rating: isMatchPlayCompetition ? null : slopeManual,
      course_rating: isMatchPlayCompetition ? null : courseRatingManual,
      match_opponent_handicap: roundType === "competition" && isMatchPlayCompetition ? parsedOpponentHandicap : null,
      om_match_result: roundType === "competition" && isMatchPlayCompetition ? omMatchResult : null,
      match_score_text: roundType === "competition" && isMatchPlayCompetition ? matchScoreText.trim() : null,
      notes: notes.trim() || null,
      om_organization_id: roundType === "competition" ? omOrganizationId : null,
      om_competition_level: roundType === "competition" ? (isMatchPlayCompetition ? null : omCompetitionLevel) : null,
      om_competition_format: roundType === "competition" ? omCompetitionFormat : null,
      om_rounds_18_count: roundType === "competition" ? (isMatchPlayCompetition ? null : omRounds18Count) : null,
      score_entry_mode: roundType === "competition" ? (isMatchPlayCompetition ? "full" : omScoreEntryMode) : "full",
      om_match_play_wins:
        roundType === "competition"
          ? isMatchPlayCompetition
            ? omMatchResult === "won"
              ? 1
              : 0
            : 0
          : 0,
      om_is_exceptional: roundType === "competition" ? (isMatchPlayCompetition ? false : omIsExceptional) : false,
      om_exceptional_tournament_id:
        roundType === "competition" && !isMatchPlayCompetition && omIsExceptional ? omExceptionalTournamentId : null,
      om_stats_submitted_at: roundType === "competition" ? new Date().toISOString() : null,
    };

    const roundDatesToCreate =
      isMultiRoundStrokePlay ? multiRoundDates.slice(0, omRounds18Count) : [startAt];
    const roundDates: string[] = [];
    for (const roundDate of roundDatesToCreate) {
      const roundDt = new Date(`${roundDate}T00:00:00`);
      if (Number.isNaN(roundDt.getTime())) {
        setError(t("roundsNew.error.invalidDate"));
        setBusy(false);
        return;
      }
      roundDates.push(roundDt.toISOString());
    }

    const shouldSaveNineHoles = !isMatchPlayCompetition
      && (roundType === "competition" ? isSingleNineCompetition : playHolesMode === "9");
    const holes = isMatchPlayCompetition
      ? null
      : Array.from({ length: shouldSaveNineHoles ? 9 : 18 }, (_, i) => ({
          hole_no: i + 1,
          par: null,
          stroke_index: null,
        }));
    const created = await supabase.rpc("create_player_golf_rounds_transactional", {
      p_player_id: uid,
      p_round_payload: payloadBase,
      p_round_dates: roundDates,
      p_holes: holes ?? [],
    });
    if (created.error) {
      setError(mapPlayerTransactionError(created.error, t("roundsNew.error.createFailed")).error);
      setBusy(false);
      return;
    }

    const createdRoundIds = Array.isArray(created.data)
      ? created.data.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    if (createdRoundIds.length !== roundDates.length) {
      setError(t("roundsNew.error.createFailed"));
      setBusy(false);
      return;
    }

    if (isMatchPlayCompetition) {
      router.push("/player/golf?section=rounds");
    } else {
      router.push(`/player/golf/rounds/${createdRoundIds[0]}/edit?mode=${inputMode}`);
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("rounds.title"), href: "/player/golf?section=rounds" }, { label: t("common.add") }]} />
        <div className="glass-section">
          <div className={`marketplace-header ${styles.heroHeader}`}>
            <div style={{ display: "grid", gap: 10 }}>
              <h1 className="section-title" style={{ marginBottom: 0 }}>
                {t("roundsNew.title")}
              </h1>
              <div className="section-subtitle">
                {t("roundsNew.subtitle")}
              </div>
            </div>

            <div className={styles.heroActions}>
              <Link className={styles.headerAction} href="/player/golf?section=rounds">
                <ArrowLeft size={15} aria-hidden="true" />
                {t("common.back")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className={`glass-card ${styles.formCard}`}>
            <div className={styles.cardHeader}>
              <h2>{pickLocaleText(locale, "Informations du parcours", "Round details")}</h2>
              <p>{pickLocaleText(locale, "Renseignez votre partie avant de passer à la carte de score.", "Set up your round before filling in the scorecard.")}</p>
            </div>
            <form onSubmit={createRound} className={styles.roundForm}>
              <div className={styles.detailsGrid}>
                <label style={{ display: "grid", gap: 6, width: "100%", minWidth: 0 }}>
                  <span style={fieldLabelStyle}>{t("common.date")}</span>
                  <input
                    type="date"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    disabled={busy}
                    style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6, width: "100%", minWidth: 0 }}>
                  <span style={fieldLabelStyle}>{t("roundsNew.startHandicap")}</span>
                  <input
                    inputMode="decimal"
                    value={handicapStart}
                    onChange={(e) => setHandicapStart(e.target.value)}
                    disabled={busy}
                    placeholder="ex: 18.4"
                    style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
                  />
                </label>
              </div>

              <div className="hr-soft" />

              <div style={{ display: "grid", gap: 10 }}>
                <div style={fieldLabelStyle}>{t("roundsNew.roundType")}</div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ ...chipRadioStyle, ...(roundType === "training" ? chipRadioActive : {}) }}>
                    <input type="radio" checked={roundType === "training"} onChange={() => setRoundType("training")} disabled={busy} />
                    <span>{t("rounds.training")}</span>
                  </label>

                  <label style={{ ...chipRadioStyle, ...(roundType === "competition" ? chipRadioActive : {}) }}>
                    <input
                      type="radio"
                      checked={roundType === "competition"}
                      onChange={() => setRoundType("competition")}
                      disabled={busy}
                    />
                    <span>{t("rounds.competition")}</span>
                  </label>
                </div>

                {roundType === "competition" && (
                  <div style={{ display: "grid", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("roundsNew.competitionName")}</span>
                      <input value={competitionName} onChange={(e) => setCompetitionName(e.target.value)} disabled={busy} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{pickLocaleText(locale, "Format competition", "Competition format")}</span>
                      <select value={omCompetitionFormat} onChange={(e) => setOmCompetitionFormat(e.target.value as OmCompetitionFormat)} disabled={busy}>
                        <option value="stroke_play_individual">{pickLocaleText(locale, "Individuel", "Individual")}</option>
                        <option value="match_play_individual">{pickLocaleText(locale, "Individuel match-play", "Individual match-play")}</option>
                      </select>
                    </label>

                    {!isMatchPlayCompetition && (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{pickLocaleText(locale, "Niveau du tournoi", "Tournament level")}</span>
                        <select
                          value={omCompetitionLevelSelect}
                          onChange={(e) => setOmCompetitionLevelSelect(e.target.value as OmCompetitionLevelSelect)}
                          disabled={busy}
                        >
                          <option value="club_internal">{pickLocaleText(locale, "Tournoi interne", "Internal tournament")}</option>
                          <option value="club_official">{pickLocaleText(locale, "Tournoi club", "Club tournament")}</option>
                          <option value="regional">{pickLocaleText(locale, "Tournoi régional", "Regional tournament")}</option>
                          <option value="national">{pickLocaleText(locale, "Tournoi national", "National tournament")}</option>
                          <option value="international">{pickLocaleText(locale, "Tournoi international", "International tournament")}</option>
                          {canUseExceptional ? (
                            <option value="exceptional">{pickLocaleText(locale, "Tournoi exceptionnel", "Exceptional tournament")}</option>
                          ) : null}
                        </select>
                      </label>
                    )}

                    {!isMatchPlayCompetition && (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{pickLocaleText(locale, "Nombre de tours joués", "Number of rounds played")}</span>
                        <select
                          value={omSingleNine ? "1x9" : String(omRounds18Count)}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "1x9") {
                              setOmSingleNine(true);
                              setOmRounds18Count(1);
                              setPlayHolesMode("9");
                              return;
                            }
                            setOmSingleNine(false);
                            setOmRounds18Count(Number(v) as 1 | 2 | 3 | 4);
                          }}
                          disabled={busy}
                        >
                          <option value="1x9">1 x 9</option>
                          <option value="1">1 x 18</option>
                          <option value="2">2 x 18</option>
                          <option value="3">3 x 18</option>
                          <option value="4">4 x 18</option>
                        </select>
                      </label>
                    )}

                    {roundType === "competition" && !isMatchPlayCompetition ? (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>Saisie des résultats</span>
                        <select value={omScoreEntryMode} onChange={(e) => setOmScoreEntryMode(e.target.value as "full" | "hole_only")} disabled={busy}>
                          <option value="full">Score du trou et statistiques</option>
                          <option value="hole_only">Score du trou uniquement</option>
                        </select>
                      </label>
                    ) : null}

                    {isMultiRoundStrokePlay ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={fieldLabelStyle}>{pickLocaleText(locale, "Dates des parties", "Round dates")}</div>
                        {Array.from({ length: omRounds18Count }).map((_, idx) => (
                          <label key={`round-date-${idx}`} style={{ display: "grid", gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                              {pickLocaleText(locale, `Partie ${idx + 1}`, `Round ${idx + 1}`)}
                            </span>
                            <input
                              type="date"
                              value={multiRoundDates[idx] ?? ""}
                              onChange={(e) =>
                                setMultiRoundDates((prev) => {
                                  const next = [...prev];
                                  next[idx] = e.target.value;
                                  return next;
                                })
                              }
                              disabled={busy}
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {omCompetitionFormat === "match_play_individual" && (
                      <div style={{ display: "grid", gap: 10 }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{pickLocaleText(locale, "Parcours", "Course")}</span>
                          <input value={matchCourseName} onChange={(e) => setMatchCourseName(e.target.value)} disabled={busy} />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{pickLocaleText(locale, "Hcp de l'adversaire", "Opponent handicap")}</span>
                          <input
                            inputMode="decimal"
                            value={opponentHandicap}
                            onChange={(e) => setOpponentHandicap(e.target.value)}
                            disabled={busy}
                            placeholder="ex: 8.4"
                          />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{pickLocaleText(locale, "Resultat du match", "Match result")}</span>
                          <select
                            value={omMatchResult}
                            onChange={(e) => setOmMatchResult(e.target.value as OmMatchResult)}
                            disabled={busy}
                          >
                            <option value="won">{pickLocaleText(locale, "Match gagne", "Match won")}</option>
                            <option value="lost">{pickLocaleText(locale, "Match perdu", "Match lost")}</option>
                          </select>
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{pickLocaleText(locale, "Score", "Score")}</span>
                          <input
                            value={matchScoreText}
                            onChange={(e) => setMatchScoreText(e.target.value)}
                            disabled={busy}
                            placeholder={pickLocaleText(locale, "ex: 3&2", "e.g. 3&2")}
                          />
                        </label>
                      </div>
                    )}

                    {!isMatchPlayCompetition && canUseExceptional && omCompetitionLevelSelect === "exceptional" && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{pickLocaleText(locale, "Selection du tournoi exceptionnel", "Exceptional tournament selection")}</span>
                          <select
                            value={omExceptionalTournamentId}
                            onChange={(e) => setOmExceptionalTournamentId(e.target.value)}
                            disabled={busy}
                          >
                            <option value="">{pickLocaleText(locale, "— Choisir —", "— Choose —")}</option>
                            {exceptionalTournaments.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="hr-soft" />

              {/* ✅ section title removed here */}

              <div style={{ display: "grid", gap: 10 }}>
                {isMatchPlayCompetition ? (
                  <div
                    style={{
                      border: "1px solid rgba(0,0,0,0.10)",
                      borderRadius: 16,
                      background: "rgba(255,255,255,0.65)",
                      padding: 12,
                      fontSize: 13,
                      fontWeight: 800,
                      color: "rgba(0,0,0,0.72)",
                    }}
                  >
                    {pickLocaleText(
                      locale,
                      "Mode match-play: pas de recherche de parcours ni de carte de score a remplir.",
                      "Match-play mode: no course search and no scorecard to complete."
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      border: "1px solid rgba(0,0,0,0.10)",
                      borderRadius: 16,
                      background: "rgba(255,255,255,0.65)",
                      padding: 12,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{pickLocaleText(locale, "Nom du parcours", "Course name")}</span>
                      <input value={manualLocation} onChange={(e) => setManualLocation(e.target.value)} disabled={busy} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("roundsNew.startTee")}</span>
                      <select value={manualTeeColor} onChange={(e) => setManualTeeColor(e.target.value as ManualTeeColor)} disabled={busy}>
                        <option value="white">{pickLocaleText(locale, "Blanc", "White")}</option>
                        <option value="yellow">{pickLocaleText(locale, "Jaune", "Yellow")}</option>
                        <option value="blue">{pickLocaleText(locale, "Bleu", "Blue")}</option>
                        <option value="red">{pickLocaleText(locale, "Rouge", "Red")}</option>
                      </select>
                    </label>

                    {roundType === "training" && (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{pickLocaleText(locale, "Nombre de trous", "Number of holes")}</span>
                        <select value={playHolesMode} onChange={(e) => setPlayHolesMode(e.target.value as PlayHolesMode)} disabled={busy}>
                          <option value="9">{pickLocaleText(locale, "9 trous", "9 holes")}</option>
                          <option value="18">{pickLocaleText(locale, "18 trous", "18 holes")}</option>
                        </select>
                      </label>
                    )}

                    <div className="grid-2">
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{roundType === "competition" ? "Slope" : pickLocaleText(locale, "Slope (optionnel)", "Slope (optional)")}</span>
                        <input inputMode="numeric" value={manualSlope} onChange={(e) => setManualSlope(e.target.value)} disabled={busy} placeholder="ex: 125" />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{roundType === "competition" ? t("roundsNew.courseRating") : pickLocaleText(locale, "Course Rating (optionnel)", "Course Rating (optional)")}</span>
                        <input inputMode="decimal" value={manualCourseRating} onChange={(e) => setManualCourseRating(e.target.value)} disabled={busy} placeholder="ex: 71.4" />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="hr-soft" />

              {!isMatchPlayCompetition ? (
                <fieldset className={styles.scoreSection}>
                  <legend>{pickLocaleText(locale, "Saisie du score", "Score entry")}</legend>
                  <div className={styles.scoreChoices}>
                    <label className={`${styles.scoreChoice} ${inputMode === "guided" ? styles.scoreChoiceActive : ""}`}>
                      <input type="radio" name="input-mode" checked={inputMode === "guided"} onChange={() => setInputMode("guided")} disabled={busy} />
                      <span><strong>{pickLocaleText(locale, "Trou par trou", "Hole by hole")}</strong><small>{pickLocaleText(locale, "Guidé, idéal sur mobile", "Guided, ideal on mobile")}</small></span>
                    </label>
                    <label className={`${styles.scoreChoice} ${inputMode === "grid" ? styles.scoreChoiceActive : ""}`}>
                      <input type="radio" name="input-mode" checked={inputMode === "grid"} onChange={() => setInputMode("grid")} disabled={busy} />
                      <span><strong>{pickLocaleText(locale, "Tous les trous", "All holes")}</strong><small>{pickLocaleText(locale, "Grille rapide avec totaux", "Quick grid with totals")}</small></span>
                    </label>
                  </div>
                  <p className={styles.scoreHint}>{pickLocaleText(locale, "Vous pourrez changer de mode à tout moment sans effacer les scores.", "You can switch modes at any time without losing scores.")}</p>
                </fieldset>
              ) : null}

              <div className="hr-soft" />

              <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>{t("roundsNew.notesOptional")}</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={busy}
                  placeholder={t("roundsNew.notesPlaceholder")}
                  style={{ minHeight: 110 }}
                />
              </label>

              <div className={styles.formActions}>
                <Link className={`${styles.actionButton} ${styles.secondaryAction}`} href="/player/golf?section=rounds">
                  {t("common.cancel")}
                </Link>
                <button
                  className={`${styles.actionButton} ${styles.primaryAction}`}
                  type="submit"
                  disabled={!canSave || busy}
                >
                  {busy
                    ? t("roundsNew.creating")
                    : isMatchPlayCompetition
                    ? pickLocaleText(locale, "Creer le match", "Create match")
                    : t("roundsNew.createAndEnter")}
                </button>
              </div>
            </form>
          </div>
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

const chipRadioStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.12)",
  borderRadius: 999,
  padding: "8px 12px",
  background: "rgba(255,255,255,0.70)",
  fontWeight: 900,
  fontSize: 13,
  color: "rgba(0,0,0,0.78)",
  cursor: "pointer",
  userSelect: "none",
};

const chipRadioActive: React.CSSProperties = {
  borderColor: "rgba(53,72,59,0.35)",
  background: "rgba(53,72,59,0.10)",
};
