"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";

type ApiCourseLite = {
  id: string | number;
  course_name: string;
  club_name?: string;
  city?: string;
  country?: string;
};

type ApiTee = {
  id: string;
  gender: "male" | "female";
  tee_name: string;
  slope_rating: number | null;
  course_rating: number | null;
  holes: Array<{ par?: number; handicap?: number }>;
};

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

function safeStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function normalizeCourses(payload: any): ApiCourseLite[] {
  const arr = payload?.courses ?? payload?.data ?? payload?.results ?? payload ?? [];
  if (!Array.isArray(arr)) return [];

  return arr
    .map((c: any) => ({
      id: c.id ?? c.course_id ?? c.uuid ?? c._id,
      course_name: c.course_name ?? c.name ?? "",
      club_name: c.club_name ?? "",
      city: c.location?.city ?? "",
      country: c.location?.country ?? "",
    }))
    .filter((x: any) => x.id != null && x.course_name);
}

function wantedTee(teeName: string, gender: "male" | "female") {
  const n = norm(teeName);
  if (gender === "male") {
    if (n.includes("white") || n.includes("blanc")) return "blanc-h";
    if (n.includes("yellow") || n.includes("jaune")) return "jaune-h";
  } else {
    if (n.includes("blue") || n.includes("bleu")) return "bleu-f";
    if (n.includes("red") || n.includes("rouge")) return "rouge-f";
  }
  return null;
}

function normalizeTees(courseDetail: any): ApiTee[] {
  const root = courseDetail?.course ?? courseDetail?.data ?? courseDetail;
  const teesObj = root?.tees;

  const female = Array.isArray(teesObj?.female) ? teesObj.female : [];
  const male = Array.isArray(teesObj?.male) ? teesObj.male : [];

  const out: ApiTee[] = [];

  female.forEach((t: any, idx: number) => {
    const tee_name = safeStr(t?.tee_name ?? t?.name ?? "");
    if (!wantedTee(tee_name, "female")) return;

    out.push({
      id: `female-${idx}-${tee_name}`,
      gender: "female",
      tee_name,
      slope_rating: typeof t?.slope_rating === "number" ? t.slope_rating : null,
      course_rating: typeof t?.course_rating === "number" ? t.course_rating : null,
      holes: Array.isArray(t?.holes) ? t.holes : [],
    });
  });

  male.forEach((t: any, idx: number) => {
    const tee_name = safeStr(t?.tee_name ?? t?.name ?? "");
    if (!wantedTee(tee_name, "male")) return;

    out.push({
      id: `male-${idx}-${tee_name}`,
      gender: "male",
      tee_name,
      slope_rating: typeof t?.slope_rating === "number" ? t.slope_rating : null,
      course_rating: typeof t?.course_rating === "number" ? t.course_rating : null,
      holes: Array.isArray(t?.holes) ? t.holes : [],
    });
  });

  const orderKey = (t: ApiTee) => {
    const n = norm(t.tee_name);
    if (t.gender === "male" && (n.includes("white") || n.includes("blanc"))) return 1;
    if (t.gender === "male" && (n.includes("yellow") || n.includes("jaune"))) return 2;
    if (t.gender === "female" && (n.includes("blue") || n.includes("bleu"))) return 3;
    if (t.gender === "female" && (n.includes("red") || n.includes("rouge"))) return 4;
    return 99;
  };

  return out.sort((a, b) => orderKey(a) - orderKey(b));
}

function teeLabel(t: ApiTee) {
  const n = norm(t.tee_name);
  let color = t.tee_name;

  if (n.includes("white") || n.includes("blanc")) color = "Tee blanc";
  else if (n.includes("yellow") || n.includes("jaune")) color = "Tee jaune";
  else if (n.includes("blue") || n.includes("bleu")) color = "Tee bleu";
  else if (n.includes("red") || n.includes("rouge")) color = "Tee rouge";

  const gender = t.gender === "male" ? "Homme" : "Femme";
  const parts = [`${color} (${gender})`];
  if (typeof t.slope_rating === "number") parts.push(`Slope ${t.slope_rating}`);
  if (typeof t.course_rating === "number") parts.push(`CR ${t.course_rating}`);
  return parts.join(" • ");
}

function manualTeeLabel(color: ManualTeeColor) {
  if (color === "white") return "Tee blanc";
  if (color === "yellow") return "Tee jaune";
  if (color === "blue") return "Tee bleu";
  return "Tee rouge";
}

function teeHolesPrefill(tees: ApiTee[], selectedTeeId: string, playMode: PlayHolesMode) {
  const t = tees.find((x) => x.id === selectedTeeId);
  const holes = t?.holes;
  if (!t || !Array.isArray(holes) || holes.length === 0) return null;

  const base = holes.slice(0, 18).map((h: any, i: number) => ({
    hole_no: i + 1,
    par: h?.par == null ? null : Number(h.par),
    stroke_index: h?.handicap == null ? null : Number(h.handicap),
  }));

  if (playMode === "9") return base.slice(0, 9);

  if (base.length === 9 && playMode === "18") {
    const back9 = base.map((h, i) => ({ ...h, hole_no: i + 10 }));
    return [...base, ...back9];
  }

  return base;
}

function localContainsFilter(list: ApiCourseLite[], query: string) {
  const nq = norm(query);
  if (!nq) return list;

  const scored = list
    .map((c) => {
      const hay = norm(`${c.course_name} ${c.club_name ?? ""} ${c.city ?? ""} ${c.country ?? ""}`);
      const idx = hay.indexOf(nq);
      return { c, idx };
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  const filtered = scored.map((x) => x.c);
  return filtered.length ? filtered : list;
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
  const debounceRef = useRef<any>(null);

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
  const [omMatchPlayWins, setOmMatchPlayWins] = useState<string>("0");
  const [omMatchResult, setOmMatchResult] = useState<OmMatchResult>("won");
  const [opponentHandicap, setOpponentHandicap] = useState<string>("");
  const [matchScoreText, setMatchScoreText] = useState<string>("");
  const [matchCourseName, setMatchCourseName] = useState<string>("");
  const [omIsExceptional, setOmIsExceptional] = useState(false);
  const [omExceptionalTournamentId, setOmExceptionalTournamentId] = useState<string>("");
  const [exceptionalTournaments, setExceptionalTournaments] = useState<ExceptionalTournamentRow[]>([]);

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ApiCourseLite[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<ApiCourseLite | null>(null);
  const [manualCourseOpen, setManualCourseOpen] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [manualTeeColor, setManualTeeColor] = useState<ManualTeeColor>("yellow");
  const [manualSlope, setManualSlope] = useState<string>("");
  const [manualCourseRating, setManualCourseRating] = useState<string>("");

  const [courseDetail, setCourseDetail] = useState<any | null>(null);
  const [tees, setTees] = useState<ApiTee[]>([]);
  const [selectedTeeId, setSelectedTeeId] = useState("");
  const [playHolesMode, setPlayHolesMode] = useState<PlayHolesMode>("18");

  const selectedTee = useMemo(() => tees.find((t) => t.id === selectedTeeId) ?? null, [tees, selectedTeeId]);
  const selectedTeeHolesCount = selectedTee?.holes?.length ?? 0;
  const selectedTeeIsNineHoles = selectedTeeHolesCount === 9;

  useEffect(() => {
    if (roundType === "competition" && omCompetitionFormat !== "match_play_individual" && omSingleNine && omRounds18Count === 1) {
      setPlayHolesMode("9");
      return;
    }
    if (roundType === "competition") {
      if (selectedTeeIsNineHoles) {
        setPlayHolesMode("9");
        return;
      }
      setPlayHolesMode("18");
      return;
    }
  }, [selectedTeeIsNineHoles, roundType, omCompetitionFormat, omSingleNine, omRounds18Count]);

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

  async function fetchSearch(query: string): Promise<ApiCourseLite[]> {
    const r = await fetch(`/api/golfcourse/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error ?? t("roundsNew.error.searchApi"));
    return normalizeCourses(j);
  }

  async function doSearch(query: string) {
    const s = query.trim();
    if (s.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      let list = await fetchSearch(s);

      if (list.length < 3 && s.length >= 3) {
        const fallback = await fetchSearch(s.slice(0, 2));
        const map = new Map<string, ApiCourseLite>();
        [...list, ...fallback].forEach((c) => map.set(String(c.id), c));
        list = Array.from(map.values());
      }

      const final = localContainsFilter(list, s);
      setResults(final);
    } catch (e: any) {
      setResults([]);
      setError(e?.message ?? t("roundsNew.error.search"));
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 220);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function selectCourse(c: ApiCourseLite) {
    setError(null);
    setSelectedCourse(c);
    setCourseDetail(null);
    setTees([]);
    setSelectedTeeId("");
    setResults([]);

    try {
      const r = await fetch(`/api/golfcourse/course/${encodeURIComponent(String(c.id))}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? t("roundsNew.error.courseApi"));

      setCourseDetail(j);
      const teeList = normalizeTees(j);
      setTees(teeList);
      setSelectedTeeId("");
    } catch (e: any) {
      setError(e?.message ?? t("roundsNew.error.course"));
    }
  }

  function applyTee(teeId: string) {
    setSelectedTeeId(teeId);
  }

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
    if (isMultiRoundStrokePlay) {
      for (let i = 0; i < omRounds18Count; i += 1) {
        const d = multiRoundDates[i] ?? "";
        if (!d) return false;
        const v = new Date(`${d}T00:00:00`);
        if (Number.isNaN(v.getTime())) return false;
      }
    }
    if (!isMatchPlayCompetition) {
      if (!selectedCourse && !manualCourseOpen) return false;
      if (selectedCourse && !selectedTeeId) return false;
      if (manualCourseOpen && !manualLocation.trim()) return false;
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
      const wins = Number(omMatchPlayWins);
      if (!Number.isFinite(wins) || wins < 0 || Math.floor(wins) !== wins) return false;
      if (omCompetitionFormat === "match_play_individual" && wins < 0) return false;
      if (omIsExceptional && !omExceptionalTournamentId) return false;
    }

    if (!isMatchPlayCompetition && manualCourseOpen) {
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
      if (manualCourseOpen) {
        if (manualSlope.trim() === "" || manualCourseRating.trim() === "") return false;
      } else {
        if (!selectedTeeId) return false;
      }
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
    omMatchPlayWins,
    omIsExceptional,
    omExceptionalTournamentId,
    selectedCourse,
    selectedTeeId,
    handicapStart,
    manualCourseOpen,
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

    if (!isMatchPlayCompetition && !selectedCourse && !manualCourseOpen) {
      setError(t("roundsNew.error.chooseCourse"));
      setBusy(false);
      return;
    }

    const selectedTeeObj = !isMatchPlayCompetition && selectedCourse ? tees.find((t) => t.id === selectedTeeId) ?? null : null;
    if (!isMatchPlayCompetition && selectedCourse && !selectedTeeObj) {
      setError(t("roundsNew.error.chooseTee"));
      setBusy(false);
      return;
    }

    const handicap_start = handicapStart.trim() === "" ? null : Number(handicapStart);
    if (handicap_start !== null && Number.isNaN(handicap_start)) {
      setError(t("roundsNew.error.invalidHandicap"));
      setBusy(false);
      return;
    }

    const slopeManual = !isMatchPlayCompetition && manualCourseOpen && manualSlope.trim() !== "" ? Number(manualSlope) : null;
    const courseRatingManual = !isMatchPlayCompetition && manualCourseOpen && manualCourseRating.trim() !== "" ? Number(manualCourseRating) : null;
    if (!isMatchPlayCompetition && manualCourseOpen && slopeManual !== null && Number.isNaN(slopeManual)) {
      setError("Slope invalide");
      setBusy(false);
      return;
    }
    if (!isMatchPlayCompetition && manualCourseOpen && courseRatingManual !== null && Number.isNaN(courseRatingManual)) {
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
      if (!isMatchPlayCompetition && manualCourseOpen && (slopeManual == null || courseRatingManual == null)) {
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
      if (!isMatchPlayCompetition && !manualCourseOpen && (!selectedTeeObj || selectedTeeObj.slope_rating == null || selectedTeeObj.course_rating == null)) {
        setError(
          pickLocaleText(
            locale,
            "Le tee selectionne doit fournir Course Rating et Slope Rating pour une competition.",
            "Selected tee must provide Course Rating and Slope Rating for a competition."
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

    const matchPlayWins = Number(omMatchPlayWins);
    const parsedOpponentHandicap = opponentHandicap.trim() ? Number(opponentHandicap) : null;

    const payloadBase: any = {
      user_id: uid,
      location: isMatchPlayCompetition ? matchCourseName.trim() : manualCourseOpen ? manualLocation.trim() : null,
      round_type: roundType,
      competition_name: roundType === "competition" ? competitionName.trim() : null,
      handicap_start,
      course_source: isMatchPlayCompetition ? "manual" : manualCourseOpen ? "manual" : "golfcourseapi",
      course_name: isMatchPlayCompetition ? matchCourseName.trim() : manualCourseOpen ? manualLocation.trim() : selectedCourse?.course_name?.trim() || null,
      external_course_id: isMatchPlayCompetition || manualCourseOpen ? null : safeStr(selectedCourse?.id),
      tee_name: isMatchPlayCompetition ? null : manualCourseOpen ? manualTeeLabel(manualTeeColor) : selectedTeeObj?.tee_name?.trim() || null,
      slope_rating: isMatchPlayCompetition ? null : manualCourseOpen ? slopeManual : typeof selectedTeeObj?.slope_rating === "number" ? selectedTeeObj.slope_rating : null,
      course_rating: isMatchPlayCompetition
        ? null
        : manualCourseOpen
        ? courseRatingManual
        : typeof selectedTeeObj?.course_rating === "number"
        ? selectedTeeObj.course_rating
        : null,
      match_opponent_handicap: roundType === "competition" && isMatchPlayCompetition ? parsedOpponentHandicap : null,
      om_match_result: roundType === "competition" && isMatchPlayCompetition ? omMatchResult : null,
      match_score_text: roundType === "competition" && isMatchPlayCompetition ? matchScoreText.trim() : null,
      notes: notes.trim() || null,
      om_organization_id: roundType === "competition" ? omOrganizationId : null,
      om_competition_level: roundType === "competition" ? (isMatchPlayCompetition ? null : omCompetitionLevel) : null,
      om_competition_format: roundType === "competition" ? omCompetitionFormat : null,
      om_rounds_18_count: roundType === "competition" ? (isMatchPlayCompetition ? null : omRounds18Count) : null,
      om_match_play_wins:
        roundType === "competition"
          ? isMatchPlayCompetition
            ? omMatchResult === "won"
              ? 1
              : 0
            : Number.isFinite(matchPlayWins)
            ? matchPlayWins
            : 0
          : 0,
      om_is_exceptional: roundType === "competition" ? (isMatchPlayCompetition ? false : omIsExceptional) : false,
      om_exceptional_tournament_id:
        roundType === "competition" && !isMatchPlayCompetition && omIsExceptional ? omExceptionalTournamentId : null,
      om_stats_submitted_at: roundType === "competition" ? new Date().toISOString() : null,
    };

    const roundDatesToCreate =
      isMultiRoundStrokePlay ? multiRoundDates.slice(0, omRounds18Count) : [startAt];
    const createdRoundIds: string[] = [];
    for (const roundDate of roundDatesToCreate) {
      const roundDt = new Date(`${roundDate}T00:00:00`);
      if (Number.isNaN(roundDt.getTime())) {
        setError(t("roundsNew.error.invalidDate"));
        setBusy(false);
        return;
      }
      const ins = await supabase
        .from("golf_rounds")
        .insert({ ...payloadBase, start_at: roundDt.toISOString() })
        .select("id")
        .maybeSingle();
      if (ins.error) {
        setError(ins.error.message);
        setBusy(false);
        return;
      }
      const id = String(ins.data?.id ?? "").trim();
      if (!id) {
        setError(t("roundsNew.error.createFailed"));
        setBusy(false);
        return;
      }
      createdRoundIds.push(id);
    }

    const shouldSaveNineHoles = !isMatchPlayCompetition && (isSingleNineCompetition || playHolesMode === "9");
    const holes = isMatchPlayCompetition
      ? null
      : manualCourseOpen
      ? Array.from({ length: shouldSaveNineHoles ? 9 : 18 }, (_, i) => ({
          hole_no: i + 1,
          par: null,
          stroke_index: null,
        }))
      : teeHolesPrefill(tees, selectedTeeId, playHolesMode);
    if (holes) {
      for (const id of createdRoundIds) {
        const rows = holes.map((h) => ({
          round_id: id,
          hole_no: h.hole_no,
          par: h.par,
          stroke_index: h.stroke_index,
          score: null,
          putts: null,
          fairway_hit: null,
          note: null,
        }));
        const up = await supabase.from("golf_round_holes").upsert(rows, { onConflict: "round_id,hole_no" });
        if (up.error) console.warn("holes prefill failed:", up.error.message);
      }
    }

    if (isMatchPlayCompetition) {
      router.push("/player/golf/rounds");
    } else {
      router.push(`/player/golf/rounds/${createdRoundIds[0]}/edit`);
    }
  }

  function resetCourse() {
    setSelectedCourse(null);
    setCourseDetail(null);
    setTees([]);
    setSelectedTeeId("");
    setManualCourseOpen(false);
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("roundsNew.title")}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>
                {t("roundsNew.subtitle")}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/rounds">
                {t("common.back")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/rounds">
                {t("rounds.title")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card">
            <form onSubmit={createRound} style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 10 }}>
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
                ) : !selectedCourse ? (
                  <>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("roundsNew.searchCourse")}</span>
                      <input
                        value={q}
                        onChange={(e) => {
                          setQ(e.target.value);
                          resetCourse();
                        }}
                        disabled={busy}
                        placeholder={t("roundsNew.searchPlaceholder")}
                      />
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                        {searching ? t("roundsNew.searching") : results.length > 0 ? `${results.length} ${t("roundsNew.results")}` : " "}
                      </div>
                    </label>

                    {results.length > 0 && (
                      <div style={{ display: "grid", gap: 10 }}>
                        {results.slice(0, 10).map((c) => {
                          const loc = [c.club_name, c.city, c.country].filter(Boolean).join(" • ");

                          return (
                            <button
                              key={safeStr(c.id)}
                              type="button"
                              className="btn"
                              onClick={() => selectCourse(c)}
                              disabled={busy}
                              style={{
                                display: "grid",
                                gridTemplateRows: "auto auto",
                                justifyItems: "center",
                                alignItems: "center",
                                textAlign: "center",
                                gap: 4,
                                padding: "12px 12px",
                                width: "100%",
                                maxWidth: "100%",
                                overflow: "hidden",
                                borderRadius: 14,
                                border: "1px solid rgba(0,0,0,0.10)",
                                background: "rgba(255,255,255,0.65)",
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 950,
                                  lineHeight: 1.15,
                                  maxWidth: "100%",
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {c.course_name}
                              </div>

                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 800,
                                  color: "rgba(0,0,0,0.55)",
                                  maxWidth: "100%",
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                  overflowWrap: "anywhere",
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: 2,
                                  overflow: "hidden",
                                }}
                                title={loc}
                              >
                                {loc || " "}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                      Si tu ne trouves pas le parcours, clique sur le bouton Ajouter un parcours.
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setManualCourseOpen((v) => !v);
                        setSelectedCourse(null);
                        setCourseDetail(null);
                        setTees([]);
                        setSelectedTeeId("");
                      }}
                      disabled={busy}
                    >
                      Ajouter un parcours
                    </button>

                    {manualCourseOpen && (
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
                          <span style={fieldLabelStyle}>Lieu</span>
                          <input value={manualLocation} onChange={(e) => setManualLocation(e.target.value)} disabled={busy} />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>Tee de départ</span>
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
                            <span style={fieldLabelStyle}>Slope (optionnel)</span>
                            <input
                              inputMode="numeric"
                              value={manualSlope}
                              onChange={(e) => setManualSlope(e.target.value)}
                              disabled={busy}
                              placeholder="ex: 125"
                            />
                          </label>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Course Rating (optionnel)</span>
                            <input
                              inputMode="decimal"
                              value={manualCourseRating}
                              onChange={(e) => setManualCourseRating(e.target.value)}
                              disabled={busy}
                              placeholder="ex: 71.4"
                            />
                          </label>
                        </div>
                      </div>
                    )}

                  </>
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
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 950 }} className="truncate">
                          {selectedCourse.course_name}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }} className="truncate">
                          {selectedCourse.club_name ?? ""}
                          {selectedCourse.city ? ` • ${selectedCourse.city}` : ""}
                          {selectedCourse.country ? ` • ${selectedCourse.country}` : ""}
                        </div>
                      </div>

                      <button type="button" className="btn" onClick={resetCourse} disabled={busy}>
                        {t("common.change")}
                      </button>
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("roundsNew.startTee")}</span>
                      <select value={selectedTeeId} onChange={(e) => applyTee(e.target.value)} disabled={busy}>
                        <option value="">{t("common.choose")}</option>
                        {tees.map((t) => (
                          <option key={t.id} value={t.id}>
                            {teeLabel(t)}
                          </option>
                        ))}
                      </select>

                      {!courseDetail && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          {t("common.loading")}
                        </div>
                      )}

                      {courseDetail && tees.length === 0 && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          {t("roundsNew.noRequiredTees")}
                        </div>
                      )}
                    </label>

                    {roundType === "training" && selectedTeeId && (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{pickLocaleText(locale, "Nombre de trous", "Number of holes")}</span>
                        <select value={playHolesMode} onChange={(e) => setPlayHolesMode(e.target.value as PlayHolesMode)} disabled={busy}>
                          <option value="9">{pickLocaleText(locale, "9 trous", "9 holes")}</option>
                          <option value="18">{pickLocaleText(locale, "18 trous", "18 holes")}</option>
                        </select>
                        {selectedTeeIsNineHoles ? (
                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                            {pickLocaleText(locale, "Sur un parcours 9 trous, 18 trous joue 2 x 9.", "On a 9-hole course, 18 holes plays 2 x 9.")}
                          </div>
                        ) : null}
                      </label>
                    )}

                    <div className="grid-2">
                      <div style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>Slope</span>
                        <div style={readOnlyPillStyle}>{selectedTee?.slope_rating ?? "—"}</div>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("roundsNew.courseRating")}</span>
                        <div style={readOnlyPillStyle}>{selectedTee?.course_rating ?? "—"}</div>
                      </div>
                    </div>

                    
                  </div>
                )}
              </div>

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

              <button
                className="cta-green cta-green-inline"
                type="submit"
                disabled={!canSave || busy}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {busy
                  ? t("roundsNew.creating")
                  : isMatchPlayCompetition
                  ? pickLocaleText(locale, "Creer le match", "Create match")
                  : t("roundsNew.createAndEnter")}
              </button>

              <div style={{ display: "flex", justifyContent: "center", marginTop: 2 }}>
                <Link className="btn" href="/player/golf/rounds">
                  {t("common.cancel")}
                </Link>
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

const readOnlyPillStyle: React.CSSProperties = {
  height: 42,
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.10)",
  background: "rgba(255,255,255,0.65)",
  display: "flex",
  alignItems: "center",
  padding: "0 12px",
  fontWeight: 950,
  color: "rgba(0,0,0,0.78)",
};
