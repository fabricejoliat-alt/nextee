"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

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

function teeHolesPrefill(tees: ApiTee[], selectedTeeId: string) {
  const t = tees.find((x) => x.id === selectedTeeId);
  const holes = t?.holes;
  if (!t || !Array.isArray(holes) || holes.length === 0) return null;

  return holes.slice(0, 18).map((h: any, i: number) => ({
    hole_no: i + 1,
    par: h?.par == null ? null : Number(h.par),
    stroke_index: h?.handicap == null ? null : Number(h.handicap),
  }));
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

export default function NewRoundPage() {
  const { t } = useI18n();
  const router = useRouter();
  const debounceRef = useRef<any>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startAt, setStartAt] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  });

  const [roundType, setRoundType] = useState<"training" | "competition">("training");
  const [competitionName, setCompetitionName] = useState("");
  const [handicapStart, setHandicapStart] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ApiCourseLite[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<ApiCourseLite | null>(null);

  const [courseDetail, setCourseDetail] = useState<any | null>(null);
  const [tees, setTees] = useState<ApiTee[]>([]);
  const [selectedTeeId, setSelectedTeeId] = useState("");

  const selectedTee = useMemo(() => tees.find((t) => t.id === selectedTeeId) ?? null, [tees, selectedTeeId]);

  useEffect(() => {
    (async () => {
      setError(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        setError(t("roundsNew.error.invalidSession"));
        return;
      }

      const profRes = await supabase.from("profiles").select("handicap").eq("id", userRes.user.id).maybeSingle();
      if (profRes.error) {
        console.warn("profile handicap load failed:", profRes.error.message);
        return;
      }

      const h = (profRes.data as ProfileRow | null)?.handicap;
      if (typeof h === "number" && Number.isFinite(h)) {
        setHandicapStart((prev) => (prev.trim() ? prev : String(h)));
      }
    })();
  }, []);

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

    const dt = new Date(startAt);
    if (Number.isNaN(dt.getTime())) return false;

    if (roundType === "competition" && !competitionName.trim()) return false;
    if (!selectedCourse) return false;
    if (!selectedTeeId) return false;

    if (handicapStart.trim()) {
      const v = Number(handicapStart);
      if (!Number.isFinite(v)) return false;
    }

    return true;
  }, [busy, startAt, roundType, competitionName, selectedCourse, selectedTeeId, handicapStart]);

  async function createRound(e: React.FormEvent) {
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

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setError(t("roundsNew.error.invalidSession"));
      setBusy(false);
      return;
    }

    if (!selectedCourse) {
      setError(t("roundsNew.error.chooseCourse"));
      setBusy(false);
      return;
    }

    const selectedTeeObj = tees.find((t) => t.id === selectedTeeId) ?? null;
    if (!selectedTeeObj) {
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

    const payload: any = {
      user_id: userRes.user.id,
      start_at: dt.toISOString(),
      location: null,
      round_type: roundType,
      competition_name: roundType === "competition" ? competitionName.trim() : null,
      handicap_start,
      course_source: "golfcourseapi",
      course_name: selectedCourse.course_name?.trim() || null,
      external_course_id: safeStr(selectedCourse.id),
      tee_name: selectedTeeObj.tee_name?.trim() || null,
      slope_rating: typeof selectedTeeObj.slope_rating === "number" ? selectedTeeObj.slope_rating : null,
      course_rating: typeof selectedTeeObj.course_rating === "number" ? selectedTeeObj.course_rating : null,
      notes: notes.trim() || null,
    };

    const ins = await supabase.from("golf_rounds").insert(payload).select("id").maybeSingle();
    if (ins.error) {
      setError(ins.error.message);
      setBusy(false);
      return;
    }

    const id = ins.data?.id;
    if (!id) {
      setError(t("roundsNew.error.createFailed"));
      setBusy(false);
      return;
    }

    const holes = teeHolesPrefill(tees, selectedTeeId);
    if (holes) {
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

    router.push(`/player/golf/rounds/${id}/edit`);
  }

  function resetCourse() {
    setSelectedCourse(null);
    setCourseDetail(null);
    setTees([]);
    setSelectedTeeId("");
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
              <div className="grid-2">
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>{t("roundsNew.dateTime")}</span>
                  <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} disabled={busy} />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>{t("roundsNew.startHandicap")}</span>
                  <input
                    inputMode="decimal"
                    value={handicapStart}
                    onChange={(e) => setHandicapStart(e.target.value)}
                    disabled={busy}
                    placeholder="ex: 18.4"
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
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("roundsNew.competitionName")}</span>
                    <input value={competitionName} onChange={(e) => setCompetitionName(e.target.value)} disabled={busy} />
                  </label>
                )}
              </div>

              <div className="hr-soft" />

              {/* ✅ section title removed here */}

              <div style={{ display: "grid", gap: 10 }}>
                {!selectedCourse ? (
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
                className="btn"
                type="submit"
                disabled={!canSave || busy}
                style={{
                  width: "100%",
                  background: "var(--green-dark)",
                  borderColor: "var(--green-dark)",
                  color: "#fff",
                }}
              >
                {busy ? t("roundsNew.creating") : t("roundsNew.createAndEnter")}
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
  border: "1px solid rgba(0,0,0,0.12)",
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
