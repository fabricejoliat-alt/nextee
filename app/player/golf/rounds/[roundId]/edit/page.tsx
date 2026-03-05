"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";

type Round = {
  id: string;
  user_id: string;
  start_at: string;
  round_type: "training" | "competition";
  course_source: string | null;
  competition_name: string | null;
  om_organization_id: string | null;
  om_competition_level: string | null;
  om_competition_format: string | null;
  om_rounds_18_count: number | null;
  om_miss_cut: boolean | null;
  course_name: string | null;
  tee_name: string | null;
  slope_rating: number | null;
  course_rating: number | null;
};

type Hole = {
  id?: string;
  hole_no: number;
  par: number | null;
  stroke_index: number | null;
  score: number | null;
  putts: number | null;
  fairway_hit: boolean | null;
  note: string | null;
};

type TournamentRoundMeta = {
  id: string;
  om_miss_cut: boolean;
};

function getParamString(p: any): string | null {
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function applyConstraints(base: Hole, patch: Partial<Hole>): Hole {
  const next: Hole = { ...base, ...patch };

  // score: clamp 0..30 if number
  if (typeof next.score === "number" && Number.isFinite(next.score)) {
    next.score = clampInt(next.score, 0, 30);
  }

  // putts: clamp 0..10 and <= score (if score known)
  if (typeof next.putts === "number" && Number.isFinite(next.putts)) {
    next.putts = clampInt(next.putts, 0, 10);
  }

  if (typeof next.score === "number" && typeof next.putts === "number") {
    if (next.putts > next.score) next.putts = next.score;
  }

  return next;
}

export default function EditRoundWizardPage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const roundId = useMemo(() => getParamString((params as any)?.roundId), [params]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [uxError, setUxError] = useState<string | null>(null);
  const [nextRoundId, setNextRoundId] = useState<string | null>(null);
  const [tournamentRounds, setTournamentRounds] = useState<TournamentRoundMeta[]>([]);
  const [tournamentRoundIndex, setTournamentRoundIndex] = useState<number | null>(null);

  const [round, setRound] = useState<Round | null>(null);
  const [holes, setHoles] = useState<Hole[]>(
    Array.from({ length: 18 }, (_, i) => ({
      hole_no: i + 1,
      par: null,
      stroke_index: null,
      score: null,
      putts: null,
      fairway_hit: null,
      note: null,
    }))
  );

  const [holeIdx, setHoleIdx] = useState(0);

  const scorecardHref = useMemo(() => {
    const id = roundId ?? "";
    return `/player/golf/rounds/${id}/scorecard`;
  }, [roundId]);

  const requestedHoleIdx = useMemo(() => {
    const raw = searchParams.get("hole");
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 0;
    const holeNo = Math.max(1, Math.min(18, Math.trunc(n)));
    return holeNo - 1;
  }, [searchParams]);

  const didInitHoleRef = useRef(false);

  // --- autosave queue (single-hole upsert, debounced) ---
  const saveTimerRef = useRef<any>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const latestHoleRef = useRef<Hole | null>(null);

  async function upsertHole(h: Hole) {
    if (!roundId) return;

    const payload: any = {
      round_id: roundId,
      hole_no: h.hole_no,
      par: h.par,
      stroke_index: h.stroke_index,
      score: h.score,
      putts: h.putts,
      fairway_hit: h.fairway_hit,
      note: h.note?.trim() || null,
    };

    // ✅ IMPORTANT: never send id if missing
    if (typeof h.id === "string" && h.id.length > 0) payload.id = h.id;

    const res = await supabase
      .from("golf_round_holes")
      .upsert([payload], { onConflict: "round_id,hole_no" });

    if (res.error) throw new Error(res.error.message);

    // If we didn't have id yet, fetch it once
    if (!payload.id) {
      const readBack = await supabase
        .from("golf_round_holes")
        .select("id")
        .eq("round_id", roundId)
        .eq("hole_no", h.hole_no)
        .maybeSingle();

      if (!readBack.error && readBack.data?.id) {
        const newId = readBack.data.id as string;
        setHoles((prev) => prev.map((x) => (x.hole_no === h.hole_no ? { ...x, id: newId } : x)));
        latestHoleRef.current = { ...h, id: newId };
      }
    }

    // Keep OM points in sync with hole-by-hole editing.
    const rec = await supabase.rpc("om_recompute_round", { p_round_id: roundId });
    if (rec.error) {
      // Do not block hole save UX on OM side-effects.
      console.warn("om_recompute_round failed:", rec.error.message);
    }
  }

  function scheduleSave(h: Hole) {
    latestHoleRef.current = h;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      // serialize saves
      if (inFlightRef.current) return;

      const toSave = latestHoleRef.current;
      if (!toSave) return;

      setSaving(true);
      setError(null);

      const p = (async () => {
        try {
          await upsertHole(toSave);
        } catch (e: any) {
          setError(e?.message ?? t("trainingNew.saving"));
        } finally {
          setSaving(false);
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = p;
      await p;
    }, 180);
  }

  async function flushSave() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    // ✅ always save the CURRENT hole from state (fresh)
    const toSave = holes[holeIdx];
    if (!toSave) return;

    // wait current flight
    if (inFlightRef.current) {
      await inFlightRef.current;
    }

    setSaving(true);
    setError(null);

    const p = (async () => {
      try {
        await upsertHole(toSave);
      } catch (e: any) {
          setError(e?.message ?? t("trainingNew.saving"));
      } finally {
        setSaving(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = p;
    await p;
  }

  // --- load ---
  async function load() {
    if (!roundId) {
      setError(t("roundsEdit.error.invalidId"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const rRes = await supabase
      .from("golf_rounds")
      .select(
        "id,user_id,start_at,round_type,course_source,competition_name,om_organization_id,om_competition_level,om_competition_format,om_rounds_18_count,om_miss_cut,course_name,tee_name,slope_rating,course_rating"
      )
      .eq("id", roundId)
      .maybeSingle();

    if (rRes.error) {
      setError(rRes.error.message);
      setRound(null);
      setLoading(false);
      return;
    }
    if (!rRes.data) {
      setError(t("roundsEdit.error.notFound"));
      setRound(null);
      setLoading(false);
      return;
    }
    const loadedRound = rRes.data as Round;
    setRound(loadedRound);

    setNextRoundId(null);
    setTournamentRounds([]);
    setTournamentRoundIndex(null);
    if (
      loadedRound.round_type === "competition" &&
      (loadedRound.om_rounds_18_count ?? 1) > 1 &&
      loadedRound.om_organization_id &&
      loadedRound.om_competition_format
    ) {
      const year = new Date(loadedRound.start_at).getFullYear();
      const yearStart = `${year}-01-01T00:00:00.000Z`;
      const nextYearStart = `${year + 1}-01-01T00:00:00.000Z`;

      const sameTournamentRes = await supabase
        .from("golf_rounds")
        .select("id,start_at,competition_name,om_miss_cut")
        .eq("round_type", "competition")
        .eq("user_id", loadedRound.user_id)
        .eq("om_organization_id", loadedRound.om_organization_id)
        .eq("om_competition_format", loadedRound.om_competition_format)
        .eq("om_competition_level", loadedRound.om_competition_level)
        .eq("om_rounds_18_count", loadedRound.om_rounds_18_count)
        .gte("start_at", yearStart)
        .lt("start_at", nextYearStart)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true });

      if (!sameTournamentRes.error) {
        const normCurrentName = (loadedRound.competition_name ?? "").trim().toLowerCase();
        const sameTournament = (sameTournamentRes.data ?? []).filter((r: any) => {
          const normName = (r.competition_name ?? "").trim().toLowerCase();
          return normName === normCurrentName;
        });
        const idx = sameTournament.findIndex((r: any) => r.id === loadedRound.id);
        if (idx >= 0) {
          setTournamentRoundIndex(idx);
          setTournamentRounds(
            sameTournament.map((r: any) => ({
              id: String(r.id),
              om_miss_cut: Boolean(r.om_miss_cut),
            }))
          );
        }
        if (idx >= 0 && idx < sameTournament.length - 1) {
          const nextPlayable = sameTournament.slice(idx + 1).find((r: any) => !r.om_miss_cut);
          if (nextPlayable?.id) setNextRoundId(String(nextPlayable.id));
        }
      }
    }

    const hRes = await supabase
      .from("golf_round_holes")
      .select("id,hole_no,par,stroke_index,score,putts,fairway_hit,note")
      .eq("round_id", roundId)
      .order("hole_no", { ascending: true });

    if (hRes.error) {
      setError(hRes.error.message);
      setLoading(false);
      return;
    }

    const map = new Map<number, any>();
    (hRes.data ?? []).forEach((x: any) => map.set(x.hole_no, x));

    const maxHoleNo = Math.max(0, ...(hRes.data ?? []).map((x: any) => Number(x.hole_no) || 0));
    const holeCount = maxHoleNo > 0 && maxHoleNo <= 9 ? 9 : 18;

    // ✅ IMPORTANT: set real defaults in STATE (score = par, putts = 2) if null
    setHoles(
      Array.from({ length: holeCount }, (_, i) => {
        const holeNo = i + 1;
        const existing = map.get(holeNo);

        const par = existing?.par ?? null;

        // ✅ if score missing, default to par (or null if par unknown)
        const score = existing?.score ?? (typeof par === "number" ? par : null);

        // ✅ if putts missing, default 2 only when score exists
        const puttsRaw = existing?.putts ?? (typeof score === "number" ? 2 : null);

        const constrained = applyConstraints(
          {
            hole_no: holeNo,
            id: existing?.id,
            par,
            stroke_index: existing?.stroke_index ?? null,
            score,
            putts: puttsRaw,
            fairway_hit: existing?.fairway_hit ?? null,
            note: existing?.note ?? null,
          },
          {}
        );

        return constrained;
      })
    );

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // ✅ after first load, jump to requested hole (?hole=)
  useEffect(() => {
    if (loading) return;
    if (didInitHoleRef.current) return;
    didInitHoleRef.current = true;
    const maxIdx = Math.max(0, holes.length - 1);
    setHoleIdx(Math.min(requestedHoleIdx, maxIdx));
  }, [loading, requestedHoleIdx, holes.length]);

  // Keep latest hole pointer updated whenever current hole changes
  useEffect(() => {
    const h = holes[holeIdx];
    if (h) latestHoleRef.current = h;
    setUxError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIdx, holes.length]);

  // --- actions (ALL autosave) ---
  const hole = holes[holeIdx];
  const isLastHole = holeIdx === holes.length - 1;
  const fairwayChosen = hole?.fairway_hit !== null;
  const isManualCourse = round?.course_source === "manual";
  const isPar3 = hole?.par === 3;
  const missLabel = isPar3 ? t("roundsEdit.missGreen") : t("roundsEdit.missFairway");
  const hitLabel = isPar3 ? t("roundsEdit.hitGreen") : t("roundsEdit.hitFairway");
  const chooseLabel = isPar3 ? t("roundsEdit.chooseGreen") : t("roundsEdit.chooseFairway");

  function commitPatch(patch: Partial<Hole>) {
    if (!hole) return;

    const next = applyConstraints(hole, patch);

    setHoles((prev) => prev.map((x, i) => (i === holeIdx ? next : x)));

    scheduleSave(next);
  }

  async function goPrevHole() {
    if (isManualCourse && (hole?.par == null || !Number.isFinite(hole.par))) {
      setUxError("Le PAR du trou est obligatoire.");
      return;
    }
    if (!fairwayChosen) {
      setUxError(t("roundsEdit.chooseToContinue").replace("{label}", chooseLabel));
      return;
    }
    await flushSave();
    if (holeIdx > 0) setHoleIdx(holeIdx - 1);
  }

  async function goNextHole() {
    if (isManualCourse && (hole?.par == null || !Number.isFinite(hole.par))) {
      setUxError("Le PAR du trou est obligatoire.");
      return;
    }
    if (!fairwayChosen) {
      setUxError(t("roundsEdit.chooseToContinue").replace("{label}", chooseLabel));
      return;
    }
    await flushSave();
    if (holeIdx < holes.length - 1) setHoleIdx(holeIdx + 1);
  }

  async function finishAndGoScorecard() {
    if (isManualCourse && (hole?.par == null || !Number.isFinite(hole.par))) {
      setUxError("Le PAR du trou est obligatoire.");
      return;
    }
    if (!fairwayChosen) {
      setUxError(t("roundsEdit.chooseToContinue").replace("{label}", chooseLabel));
      return;
    }
    await flushSave();
    router.push(scorecardHref);
  }

  async function finishAndGoNextRound() {
    if (!nextRoundId) {
      await finishAndGoScorecard();
      return;
    }
    if (isManualCourse && (hole?.par == null || !Number.isFinite(hole.par))) {
      setUxError("Le PAR du trou est obligatoire.");
      return;
    }
    if (!fairwayChosen) {
      setUxError(t("roundsEdit.chooseToContinue").replace("{label}", chooseLabel));
      return;
    }
    await flushSave();
    router.push(`/player/golf/rounds/${nextRoundId}/edit`);
  }

  async function setMissCutOnRemainingRounds(checked: boolean) {
    if (!round || tournamentRoundIndex == null || tournamentRounds.length === 0) return;

    const remainingRoundIds = tournamentRounds.slice(tournamentRoundIndex + 1).map((r) => r.id);
    if (remainingRoundIds.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      if (checked) {
        const upd = await supabase
          .from("golf_rounds")
          .update({
            om_miss_cut: true,
            om_points_net: null,
            om_points_brut: null,
          })
          .in("id", remainingRoundIds);
        if (upd.error) throw new Error(upd.error.message);

        const del = await supabase.from("om_tournament_scores").delete().in("round_id", remainingRoundIds);
        if (del.error) throw new Error(del.error.message);
      } else {
        const upd = await supabase
          .from("golf_rounds")
          .update({ om_miss_cut: false })
          .in("id", remainingRoundIds);
        if (upd.error) throw new Error(upd.error.message);

        for (const id of remainingRoundIds) {
          const rpc = await supabase.rpc("om_recompute_round", { p_round_id: id });
          if (rpc.error) throw new Error(rpc.error.message);
        }
      }

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors du Miss cut.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRound() {
    if (!roundId) return;
    if (!confirm(t("roundsEdit.confirmDelete"))) return;

    const del = await supabase.from("golf_rounds").delete().eq("id", roundId);
    if (del.error) {
      setError(del.error.message);
      return;
    }
    router.push("/player/golf/rounds");
  }

  if (loading) return <CompactLoadingBlock label={t("common.loading")} />;

  if (!round) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>{t("rounds.title")}</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? t("roundsEdit.error.cannotDisplay")}
          </div>
        </div>
        <Link className="btn" href="/player/golf/rounds">
          {t("common.back")}
        </Link>
      </div>
    );
  }

  const hitSelected = hole?.fairway_hit === true;
  const missSelected = hole?.fairway_hit === false;
  const remainingRounds = tournamentRoundIndex == null ? [] : tournamentRounds.slice(tournamentRoundIndex + 1);
  const isMissCutChecked = remainingRounds.length > 0 && remainingRounds.every((r) => r.om_miss_cut);
  const canMarkMissCut =
    round?.round_type === "competition" &&
    typeof round?.om_rounds_18_count === "number" &&
    tournamentRoundIndex != null &&
    remainingRounds.length > 0 &&
    ((round.om_rounds_18_count === 3 && tournamentRoundIndex === 0) ||
      (round.om_rounds_18_count === 4 && tournamentRoundIndex === 1));

  const maxPuttsNow =
    typeof hole?.score === "number" && Number.isFinite(hole.score) ? clampInt(hole.score, 0, 10) : 10;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("roundsEdit.enterHoles")}
              </div>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
          {uxError && <div className="marketplace-error">{uxError}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 1000, fontSize: 32, lineHeight: 1 }}>
                {t("roundsEdit.hole")} {hole?.hole_no ?? holeIdx + 1}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div style={pillStyle}>
                  PAR&nbsp;: <span style={{ fontWeight: 950 }}>{hole?.par ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="hr-soft" />

            {hole && (
              <div style={{ display: "grid", gap: 14 }}>
                {/* PAR (manual courses) */}
                {isManualCourse ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={fieldLabelStyle}>PAR *</div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "56px 1fr 56px",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const nextPar = Math.max(1, Math.min(7, (hole.par ?? 4) - 1));
                          commitPatch({ par: nextPar, score: nextPar, putts: 2 });
                        }}
                        style={miniBtnStyle}
                        disabled={saving}
                      >
                        –
                      </button>

                      <input
                        className="input"
                        inputMode="numeric"
                        value={hole.par == null ? "" : String(hole.par)}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") {
                            commitPatch({ par: null });
                            return;
                          }
                          const v = Number(raw);
                          if (!Number.isFinite(v)) return;
                          const nextPar = Math.max(1, Math.min(7, Math.trunc(v)));
                          commitPatch({ par: nextPar, score: nextPar, putts: 2 });
                        }}
                        style={{ textAlign: "center", fontWeight: 950, fontSize: 18, height: 50 }}
                        disabled={saving}
                        required
                      />

                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const nextPar = Math.max(1, Math.min(7, (hole.par ?? 4) + 1));
                          commitPatch({ par: nextPar, score: nextPar, putts: 2 });
                        }}
                        style={miniBtnStyle}
                        disabled={saving}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* SCORE */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>{t("rounds.score")}</div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "56px 1fr 56px",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      onClick={() => commitPatch({ score: (hole.score ?? 0) - 1 })}
                      style={miniBtnStyle}
                      disabled={saving}
                    >
                      –
                    </button>

                    <input
                      className="input"
                      inputMode="numeric"
                      value={String(hole.score ?? 0)}
                      onChange={(e) => {
                        const v = e.target.value === "" ? 0 : Number(e.target.value);
                        commitPatch({ score: clampInt(v, 0, 30) });
                      }}
                      style={{ textAlign: "center", fontWeight: 950, fontSize: 18, height: 50 }}
                      disabled={saving}
                    />

                    <button
                      type="button"
                      className="btn"
                      onClick={() => commitPatch({ score: (hole.score ?? 0) + 1 })}
                      style={miniBtnStyle}
                      disabled={saving}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* PUTTS */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>{t("rounds.putts")}</div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "56px 1fr 56px",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const cur = hole.putts ?? 2;
                        commitPatch({ putts: clampInt(cur - 1, 0, maxPuttsNow) });
                      }}
                      style={miniBtnStyle}
                      disabled={saving}
                    >
                      –
                    </button>

                    <input
                      className="input"
                      inputMode="numeric"
                      value={String(hole.putts ?? 2)}
                      onChange={(e) => {
                        const v = e.target.value === "" ? 0 : Number(e.target.value);
                        commitPatch({ putts: clampInt(v, 0, maxPuttsNow) });
                      }}
                      style={{ textAlign: "center", fontWeight: 950, fontSize: 18, height: 50 }}
                      disabled={saving}
                    />

                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const cur = hole.putts ?? 2;
                        commitPatch({ putts: clampInt(cur + 1, 0, maxPuttsNow) });
                      }}
                      style={miniBtnStyle}
                      disabled={saving}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* FAIRWAY */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>{isPar3 ? t("roundsEdit.green") : t("roundsEdit.fairway")}</div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setUxError(null);
                        commitPatch({ fairway_hit: false });
                      }}
                      style={{
                        ...fairwayBtnBase,
                        ...(missSelected ? fairwayMissSelected : fairwayUnselected),
                      }}
                      aria-pressed={missSelected}
                      disabled={saving}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <XCircle size={18} />
                        {missLabel}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setUxError(null);
                        commitPatch({ fairway_hit: true });
                      }}
                      style={{
                        ...fairwayBtnBase,
                        ...(hitSelected ? fairwayHitSelected : fairwayUnselected),
                      }}
                      aria-pressed={hitSelected}
                      disabled={saving}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <CheckCircle2 size={18} />
                        {hitLabel}
                      </span>
                    </button>
                  </div>
                </div>

                {/* NAV / FINISH */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isLastHole && canMarkMissCut ? "1fr 1fr 1fr" : "1fr 1fr",
                    gap: 10,
                    marginTop: 4,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={goPrevHole}
                    disabled={saving || holeIdx === 0}
                    style={{ width: "100%" }}
                  >
                    {holeIdx === 0 ? t("roundsEdit.holeDash") : `${t("roundsEdit.hole")} ${holeIdx}`}
                  </button>

                  {!isLastHole ? (
                    <button type="button" className="btn" onClick={goNextHole} style={{ width: "100%" }} disabled={saving}>
                      {`${t("roundsEdit.hole")} ${holeIdx + 2}`}
                    </button>
                  ) : canMarkMissCut ? (
                    <>
                      <label
                        style={{
                          width: "100%",
                          minHeight: 44,
                          border: "1px solid rgba(185,28,28,0.45)",
                          borderRadius: 12,
                          background: "rgba(185,28,28,0.12)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 10,
                          fontWeight: 1000,
                          padding: "0 8px",
                          cursor: saving ? "not-allowed" : "pointer",
                          opacity: saving ? 0.7 : 1,
                          color: "rgba(153,27,27,1)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isMissCutChecked}
                          onChange={(e) => setMissCutOnRemainingRounds(e.target.checked)}
                          disabled={saving}
                        />
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <AlertTriangle size={16} />
                          MISS CUT
                        </span>
                      </label>
                      {nextRoundId ? (
                        <button
                          type="button"
                          className="cta-green cta-green-inline"
                          onClick={finishAndGoNextRound}
                          style={{ width: "100%" }}
                          disabled={saving}
                        >
                          Partie suivante
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cta-green cta-green-inline"
                          onClick={finishAndGoScorecard}
                          style={{ width: "100%" }}
                          disabled={saving}
                        >
                          {t("roundsEdit.finish")}
                        </button>
                      )}
                    </>
                  ) : nextRoundId ? (
                    <button
                      type="button"
                      className="cta-green cta-green-inline"
                      onClick={finishAndGoNextRound}
                      style={{ width: "100%" }}
                      disabled={saving}
                    >
                      Partie suivante
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cta-green cta-green-inline"
                      onClick={finishAndGoScorecard}
                      style={{ width: "100%" }}
                      disabled={saving}
                    >
                      {t("roundsEdit.finish")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <Link className="cta-green cta-green-inline" href={scorecardHref} style={{ width: "100%", justifyContent: "center" as any }}>
              {t("roundsEdit.showScorecard")}
            </Link>

            <button type="button" className="btn btn-danger" onClick={deleteRound} style={{ width: "100%" }} disabled={saving}>
              {t("roundsEdit.deleteRound")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "rgba(0,0,0,0.70)",
};

const pillStyle: React.CSSProperties = {
  height: 34,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.10)",
  background: "rgba(255,255,255,0.65)",
  fontWeight: 900,
  color: "rgba(0,0,0,0.75)",
};

const miniBtnStyle: React.CSSProperties = {
  height: 50,
  borderRadius: 14,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "rgba(255,255,255,0.70)",
  fontWeight: 950,
  fontSize: 20,
};

const fairwayBtnBase: React.CSSProperties = {
  height: 56,
  borderRadius: 14,
  fontWeight: 950,
  border: "1px solid rgba(0,0,0,0.12)",
  transition: "transform 140ms ease, box-shadow 140ms ease, filter 140ms ease, opacity 140ms ease",
};

const fairwayUnselected: React.CSSProperties = {
  background: "rgba(255,255,255,0.42)",
  opacity: 0.5,
  filter: "saturate(0.7) contrast(0.95)",
};

const fairwayMissSelected: React.CSSProperties = {
  background: "rgba(185,28,28,0.42)",
  opacity: 1,
  filter: "saturate(1.25) contrast(1.08)",
  transform: "translateY(-2px) scale(1.015)",
  boxShadow: "0 18px 32px rgba(0,0,0,0.18)",
};

const fairwayHitSelected: React.CSSProperties = {
  background: "rgba(21,128,61,0.46)",
  opacity: 1,
  filter: "saturate(1.25) contrast(1.08)",
  transform: "translateY(-2px) scale(1.015)",
  boxShadow: "0 18px 32px rgba(0,0,0,0.18)",
};
