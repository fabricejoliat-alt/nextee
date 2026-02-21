"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { CheckCircle2, XCircle } from "lucide-react";

type Round = {
  id: string;
  start_at: string;
  round_type: "training" | "competition";
  competition_name: string | null;
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

function getParamString(p: any): string | null {
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

export default function EditRoundWizardPage() {
  const params = useParams();
  const router = useRouter();
  const roundId = useMemo(() => getParamString((params as any)?.roundId), [params]);

  const [loading, setLoading] = useState(true);
  const [autosaving, setAutosaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const autosaveInFlight = useRef<Promise<any> | null>(null);

  const scorecardHref = useMemo(() => {
    const id = roundId ?? "";
    return `/player/golf/rounds/${id}/scorecard`;
  }, [roundId]);

  async function load() {
    if (!roundId) {
      setError("Identifiant de parcours invalide.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const rRes = await supabase
      .from("golf_rounds")
      .select("id,start_at,round_type,competition_name,course_name,tee_name,slope_rating,course_rating")
      .eq("id", roundId)
      .maybeSingle();

    if (rRes.error) {
      setError(rRes.error.message);
      setRound(null);
      setLoading(false);
      return;
    }
    if (!rRes.data) {
      setError("Parcours introuvable.");
      setRound(null);
      setLoading(false);
      return;
    }
    setRound(rRes.data as Round);

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

    const map = new Map<number, Hole>();
    (hRes.data ?? []).forEach((x: any) => map.set(x.hole_no, x));

    setHoles(
      Array.from({ length: 18 }, (_, i) => {
        const holeNo = i + 1;
        const existing = map.get(holeNo);
        return {
          hole_no: holeNo,
          id: existing?.id,
          par: existing?.par ?? null,
          stroke_index: existing?.stroke_index ?? null,
          score: existing?.score ?? null,
          putts: existing?.putts ?? null,
          fairway_hit: existing?.fairway_hit ?? null,
          note: existing?.note ?? null,
        };
      })
    );

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // ✅ update hole with constraints: putts <= score
  function updateHole(idx: number, patch: Partial<Hole>) {
    setHoles((prev) => {
      const h = prev[idx];
      if (!h) return prev;

      const nextScore = patch.score !== undefined ? patch.score : h.score;
      const nextPuttsRaw = patch.putts !== undefined ? patch.putts : h.putts;

      const maxPutts =
        typeof nextScore === "number" && Number.isFinite(nextScore) ? nextScore : 10;

      let nextPutts = nextPuttsRaw;
      if (typeof nextPuttsRaw === "number" && Number.isFinite(nextPuttsRaw)) {
        nextPutts = clampInt(nextPuttsRaw, 0, clampInt(maxPutts, 0, 10));
      }

      if (
        typeof nextScore === "number" &&
        Number.isFinite(nextScore) &&
        typeof nextPutts === "number" &&
        Number.isFinite(nextPutts) &&
        nextPutts > nextScore
      ) {
        nextPutts = nextScore;
      }

      const merged: Hole = { ...h, ...patch, score: nextScore, putts: nextPutts };
      return prev.map((x, i) => (i === idx ? merged : x));
    });
  }

  // defaults on hole enter:
  // - score defaults to PAR (or 0)
  // - putts defaults to min(2, score)
  useEffect(() => {
    setHoles((prev) => {
      const h = prev[holeIdx];
      if (!h) return prev;

      const score = h.score == null ? (typeof h.par === "number" ? h.par : 0) : h.score;
      const puttsDefault = score <= 0 ? 0 : Math.min(2, score);
      const putts = h.putts == null ? puttsDefault : Math.min(h.putts, score);

      if (score === h.score && putts === h.putts) return prev;
      return prev.map((x, i) => (i === holeIdx ? { ...x, score, putts } : x));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIdx]);

  async function saveHole(idx: number) {
    if (!roundId) return;
    const h = holes[idx];
    if (!h) return;

    const payload = {
      id: h.id,
      round_id: roundId,
      hole_no: h.hole_no,
      par: h.par,
      stroke_index: h.stroke_index,
      score: h.score,
      putts: h.putts,
      fairway_hit: h.fairway_hit,
      note: h.note?.trim() || null,
    };

    const res = await supabase.from("golf_round_holes").upsert([payload], { onConflict: "round_id,hole_no" });
    if (res.error) throw new Error(res.error.message);

    if (!h.id) {
      const readBack = await supabase
        .from("golf_round_holes")
        .select("id")
        .eq("round_id", roundId)
        .eq("hole_no", h.hole_no)
        .maybeSingle();

      if (!readBack.error && readBack.data?.id) {
        setHoles((prev) => prev.map((x, i) => (i === idx ? { ...x, id: readBack.data.id } : x)));
      }
    }
  }

  async function autosaveCurrentHole() {
    if (!roundId) return;
    if (autosaveInFlight.current) return autosaveInFlight.current;

    setAutosaving(true);
    setError(null);

    const p = (async () => {
      try {
        await saveHole(holeIdx);
      } catch (e: any) {
        setError(e?.message ?? "Erreur enregistrement.");
      } finally {
        setAutosaving(false);
        autosaveInFlight.current = null;
      }
    })();

    autosaveInFlight.current = p;
    return p;
  }

  async function saveAll() {
    if (!roundId) return;
    setSavingAll(true);
    setError(null);

    try {
      const payload = holes.map((h) => ({
        id: h.id,
        round_id: roundId,
        hole_no: h.hole_no,
        par: h.par,
        stroke_index: h.stroke_index,
        score: h.score,
        putts: h.putts,
        fairway_hit: h.fairway_hit,
        note: h.note?.trim() || null,
      }));

      const res = await supabase.from("golf_round_holes").upsert(payload, { onConflict: "round_id,hole_no" });
      if (res.error) throw new Error(res.error.message);

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Erreur enregistrement.");
    } finally {
      setSavingAll(false);
    }
  }

  async function deleteRound() {
    if (!roundId) return;
    if (!confirm("Supprimer ce parcours ?")) return;

    const del = await supabase.from("golf_rounds").delete().eq("id", roundId);
    if (del.error) {
      setError(del.error.message);
      return;
    }
    router.push("/player/golf/rounds");
  }

  const hole = holes[holeIdx];
  const isLastHole = holeIdx === 17;

  const subtitle = [
    round?.round_type === "competition"
      ? `Compétition${round?.competition_name ? ` — ${round.competition_name}` : ""}`
      : "Entraînement",
    round?.start_at ? fmtDateTime(round.start_at) : null,
    round?.course_name || null,
    round?.tee_name || null,
  ]
    .filter(Boolean)
    .join(" • ");

  async function goPrevHole() {
    await autosaveCurrentHole();
    if (holeIdx > 0) setHoleIdx(holeIdx - 1);
  }

  async function goNextHole() {
    await autosaveCurrentHole();
    if (holeIdx < 17) setHoleIdx(holeIdx + 1);
  }

  async function finishAndGoScorecard() {
    await autosaveCurrentHole();
    await saveAll();
    router.push(scorecardHref);
  }

  if (loading) return <div style={{ color: "var(--muted)" }}>Chargement…</div>;

  if (!round) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Parcours</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? "Impossible d’afficher le parcours."}
          </div>
        </div>
        <Link className="btn" href="/player/golf/rounds">
          Retour
        </Link>
      </div>
    );
  }

  const hitSelected = hole?.fairway_hit === true;
  const missSelected = hole?.fairway_hit === false;

  const maxPuttsNow =
    typeof hole?.score === "number" && Number.isFinite(hole.score) ? clampInt(hole.score, 0, 10) : 10;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* header glass */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Saisir les trous
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>{subtitle}</div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/rounds">
                Retour
              </Link>
              <Link className="cta-green cta-green-inline" href={scorecardHref}>
                Afficher la carte des scores
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* card */}
        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1000, fontSize: 32, lineHeight: 1 }}>
                Trou {hole?.hole_no ?? holeIdx + 1}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={pillStyle}>
                  PAR&nbsp;: <span style={{ fontWeight: 950 }}>{hole?.par ?? "—"}</span>
                </div>
                {(autosaving || savingAll) && (
                  <div style={{ ...pillStyle, opacity: 0.9 }}>
                    💾 {savingAll ? "Enregistrement…" : "Auto-save…"}
                  </div>
                )}
              </div>
            </div>

            <div className="hr-soft" />

            {hole && (
              <div style={{ display: "grid", gap: 14 }}>
                {/* SCORE */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>Score</div>

                  <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 56px", gap: 10, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const cur = hole.score ?? (typeof hole.par === "number" ? hole.par : 0);
                        const next = clampInt(cur - 1, 0, 30);
                        updateHole(holeIdx, { score: next });
                      }}
                      disabled={autosaving || savingAll}
                      style={miniBtnStyle}
                      aria-label="Diminuer le score"
                    >
                      –
                    </button>

                    <input
                      className="input"
                      inputMode="numeric"
                      value={hole.score ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : clampInt(Number(e.target.value), 0, 30);
                        updateHole(holeIdx, { score: v });
                      }}
                      placeholder={String(hole.par ?? "")}
                      style={{ textAlign: "center", fontWeight: 950, fontSize: 18, height: 50 }}
                    />

                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const cur = hole.score ?? (typeof hole.par === "number" ? hole.par : 0);
                        const next = clampInt(cur + 1, 0, 30);
                        updateHole(holeIdx, { score: next });
                      }}
                      disabled={autosaving || savingAll}
                      style={miniBtnStyle}
                      aria-label="Augmenter le score"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* PUTTS (<= score) */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>Putts</div>

                  <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 56px", gap: 10, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const cur = hole.putts ?? Math.min(2, maxPuttsNow);
                        const next = clampInt(cur - 1, 0, maxPuttsNow);
                        updateHole(holeIdx, { putts: next });
                      }}
                      disabled={autosaving || savingAll}
                      style={miniBtnStyle}
                      aria-label="Diminuer les putts"
                    >
                      –
                    </button>

                    <input
                      className="input"
                      inputMode="numeric"
                      value={hole.putts ?? ""}
                      onChange={(e) => {
                        const vRaw = e.target.value === "" ? null : Number(e.target.value);
                        if (vRaw === null) {
                          updateHole(holeIdx, { putts: null });
                          return;
                        }
                        const v = clampInt(vRaw, 0, maxPuttsNow);
                        updateHole(holeIdx, { putts: v });
                      }}
                      placeholder={String(Math.min(2, maxPuttsNow))}
                      style={{ textAlign: "center", fontWeight: 950, fontSize: 18, height: 50 }}
                    />

                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const cur = hole.putts ?? Math.min(2, maxPuttsNow);
                        const next = clampInt(cur + 1, 0, maxPuttsNow);
                        updateHole(holeIdx, { putts: next });
                      }}
                      disabled={autosaving || savingAll}
                      style={miniBtnStyle}
                      aria-label="Augmenter les putts"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* FAIRWAY (MISS left, HIT right) + darker selected background */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={fieldLabelStyle}>Fairway</div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {/* MISS LEFT */}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => updateHole(holeIdx, { fairway_hit: false })}
                      disabled={autosaving || savingAll}
                      style={{
                        ...fairwayBtnBase,
                        ...(missSelected ? fairwayMissSelected : fairwayMissIdle),
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <XCircle size={18} />
                        Miss Fairway
                      </span>
                    </button>

                    {/* HIT RIGHT */}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => updateHole(holeIdx, { fairway_hit: true })}
                      disabled={autosaving || savingAll}
                      style={{
                        ...fairwayBtnBase,
                        ...(hitSelected ? fairwayHitSelected : fairwayHitIdle),
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <CheckCircle2 size={18} />
                        Hit Fairway
                      </span>
                    </button>
                  </div>
                </div>

                {/* NAV / FINISH */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={goPrevHole}
                    disabled={autosaving || savingAll || holeIdx === 0}
                    style={{ width: "100%" }}
                  >
                    {holeIdx === 0 ? "Trou —" : `Trou ${holeIdx}`}
                  </button>

                  {!isLastHole ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={goNextHole}
                      disabled={autosaving || savingAll}
                      style={{
                        width: "100%",
                        background: "var(--green-dark)",
                        borderColor: "var(--green-dark)",
                        color: "#fff",
                      }}
                    >
                      {`Trou ${holeIdx + 2}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={finishAndGoScorecard}
                      disabled={autosaving || savingAll}
                      style={{
                        width: "100%",
                        background: "var(--green-dark)",
                        borderColor: "var(--green-dark)",
                        color: "#fff",
                        fontWeight: 950,
                      }}
                    >
                      {savingAll ? "Enregistrement…" : "Enregistrer"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* delete below card */}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn"
              onClick={deleteRound}
              disabled={autosaving || savingAll}
              style={{ width: "100%" }}
            >
              Supprimer ce parcours
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
  height: 54,
  borderRadius: 14,
  fontWeight: 950,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "rgba(255,255,255,0.70)",
  transition: "transform 140ms ease, box-shadow 140ms ease, background 140ms ease",
};

const fairwayMissIdle: React.CSSProperties = {
  background: "rgba(255,255,255,0.70)",
};

const fairwayHitIdle: React.CSSProperties = {
  background: "rgba(255,255,255,0.70)",
};

const fairwayMissSelected: React.CSSProperties = {
  background: "rgba(185,28,28,0.24)", // darker when selected
  transform: "translateY(-2px)",
  boxShadow: "0 16px 30px rgba(0,0,0,0.16)",
};

const fairwayHitSelected: React.CSSProperties = {
  background: "rgba(21,128,61,0.26)", // darker when selected
  transform: "translateY(-2px)",
  boxShadow: "0 16px 30px rgba(0,0,0,0.16)",
};