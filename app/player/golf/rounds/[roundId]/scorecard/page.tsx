"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Round = {
  id: string;
  start_at: string;
  round_type: "training" | "competition";
  competition_name: string | null;
  course_name: string | null;
  tee_name: string | null;

  slope_rating: number | null;
  course_rating: number | null;

  total_score: number | null;
  total_putts: number | null;
  gir: number | null;

  eagles: number | null;
  birdies: number | null;
  pars: number | null;
  bogeys: number | null;
  doubles_plus: number | null;
};

type Hole = {
  id: string;
  hole_no: number;
  par: number | null;
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

function fmtDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

// GIR rule used in your app
function isGIR(par: number | null, score: number | null, putts: number | null) {
  if (typeof par !== "number") return false;
  if (typeof score !== "number") return false;
  if (typeof putts !== "number") return false;
  return score - putts <= par - 2;
}

type ScoreMark = "none" | "birdie" | "eagle" | "bogey" | "double" | "tripleplus";

function scoreMark(par: number | null, score: number | null): ScoreMark {
  if (typeof par !== "number" || typeof score !== "number") return "none";
  const d = score - par;
  if (d <= -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 1) return "bogey";
  if (d === 2) return "double";
  if (d >= 3) return "tripleplus";
  return "none";
}

function ScoreShape({ value, mark }: { value: number | null; mark: ScoreMark }) {
  const txt = value == null ? "—" : String(value);

  const innerText = (
    <div style={{ fontWeight: 1100, fontSize: 22, lineHeight: 1, minWidth: 22, textAlign: "center" }}>{txt}</div>
  );

  if (mark === "none") return <div style={{ padding: "6px 10px" }}>{innerText}</div>;

  if (mark === "birdie") {
    return (
      <div style={{ ...shapeOuter, borderRadius: 999, border: "2px solid rgba(0,0,0,0.78)" }}>
        {innerText}
      </div>
    );
  }

  if (mark === "eagle") {
    return (
      <div style={{ ...shapeOuter, borderRadius: 999, border: "2px solid rgba(0,0,0,0.78)", padding: 4 }}>
        <div style={{ borderRadius: 999, border: "2px solid rgba(0,0,0,0.78)", padding: "6px 10px" }}>
          {innerText}
        </div>
      </div>
    );
  }

  if (mark === "bogey") {
    return (
      <div style={{ ...shapeOuter, borderRadius: 8, border: "2px solid rgba(0,0,0,0.78)" }}>
        {innerText}
      </div>
    );
  }

  if (mark === "double") {
    return (
      <div style={{ ...shapeOuter, borderRadius: 10, border: "2px solid rgba(0,0,0,0.78)", padding: 4 }}>
        <div style={{ borderRadius: 8, border: "2px solid rgba(0,0,0,0.78)", padding: "6px 10px" }}>
          {innerText}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...shapeOuter,
        borderRadius: 10,
        border: "2px solid rgba(0,0,0,0.78)",
        padding: 4,
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(0,0,0,0.38) 0px, rgba(0,0,0,0.38) 3px, rgba(0,0,0,0.00) 3px, rgba(0,0,0,0.00) 8px)",
      }}
      title="Triple bogey ou +"
    >
      <div
        style={{
          borderRadius: 8,
          border: "2px solid rgba(0,0,0,0.78)",
          padding: "6px 10px",
          background: "rgba(255,255,255,0.88)",
        }}
      >
        {innerText}
      </div>
    </div>
  );
}

const shapeOuter: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 10px",
};

export default function ScorecardPage() {
  const params = useParams();
  const roundId = useMemo(() => getParamString((params as any)?.roundId), [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);

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
      .select(
        "id,start_at,round_type,competition_name,course_name,tee_name,slope_rating,course_rating,total_score,total_putts,gir,eagles,birdies,pars,bogeys,doubles_plus"
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
      setError("Parcours introuvable.");
      setRound(null);
      setLoading(false);
      return;
    }
    setRound(rRes.data as Round);

    const hRes = await supabase
      .from("golf_round_holes")
      .select("id,hole_no,par,score,putts,fairway_hit,note")
      .eq("round_id", roundId)
      .order("hole_no", { ascending: true });

    if (hRes.error) {
      setError(hRes.error.message);
      setLoading(false);
      return;
    }

    setHoles((hRes.data ?? []) as Hole[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const computed = useMemo(() => {
    const parTotal = holes.reduce((acc, h) => acc + (typeof h.par === "number" ? h.par : 0), 0);

    const scoreTotalFromHoles = holes.reduce((acc, h) => acc + (typeof h.score === "number" ? h.score : 0), 0);
    const holesWithScore = holes.filter((h) => typeof h.score === "number").length;

    const scoreTotal =
      typeof round?.total_score === "number" ? round.total_score : holesWithScore > 0 ? scoreTotalFromHoles : null;

    const diff = typeof scoreTotal === "number" && parTotal > 0 ? scoreTotal - parTotal : null;

    const filled = holes.filter((h) => typeof h.par === "number" && typeof h.score === "number");

    let eagles = 0,
      birdies = 0,
      pars = 0,
      bogeys = 0,
      doubleBogeys = 0,
      doublesPlus = 0;

    let girCount = 0;
    let puttsTotal = 0;

    filled.forEach((h) => {
      const d = (h.score as number) - (h.par as number);

      if (d <= -2) eagles++;
      else if (d === -1) birdies++;
      else if (d === 0) pars++;
      else if (d === 1) bogeys++;
      else if (d === 2) doubleBogeys++;
      else if (d >= 3) doublesPlus++;

      if (isGIR(h.par, h.score, h.putts)) girCount++;
      if (typeof h.putts === "number") puttsTotal += h.putts;
    });

    const gir = typeof round?.gir === "number" ? round.gir : filled.length ? girCount : null;
    const putts = typeof round?.total_putts === "number" ? round.total_putts : puttsTotal || null;

    return {
      parTotal: parTotal || null,
      scoreTotal,
      diff,
      eagles: typeof round?.eagles === "number" ? round.eagles : eagles,
      birdies: typeof round?.birdies === "number" ? round.birdies : birdies,
      pars: typeof round?.pars === "number" ? round.pars : pars,
      bogeys: typeof round?.bogeys === "number" ? round.bogeys : bogeys,
      doubleBogeys,
      doublesPlus: typeof round?.doubles_plus === "number" ? round.doubles_plus : doublesPlus,
      gir,
      putts,
    };
  }, [holes, round]);

  const configLine = useMemo(() => {
    if (!round) return "";
    const parts: string[] = [];
    parts.push(round.round_type === "competition" ? "Compétition" : "Entraînement");
    if (round.course_name) parts.push(round.course_name);
    if (round.tee_name) parts.push(round.tee_name);
    return parts.filter(Boolean).join(" • ");
  }, [round]);

  if (loading) return <div style={{ color: "var(--muted)" }}>Chargement…</div>;

  if (!round) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Scorecard</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? "Impossible d’afficher la scorecard."}
          </div>
        </div>
        <Link className="btn" href="/player/golf/rounds">
          Retour
        </Link>
      </div>
    );
  }

  const diffLabel =
    typeof computed.diff === "number"
      ? computed.diff === 0
        ? "E"
        : computed.diff > 0
        ? `+${computed.diff}`
        : String(computed.diff)
      : null;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Carte de scores
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/player/golf/rounds/${round.id}/edit`}>
                Modifier
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/rounds">
                Mes parcours
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Summary glass card */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center" }}>
              <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                <div style={{ fontWeight: 1100, fontSize: 16, lineHeight: 1.15 }} className="truncate">
                  {fmtDate(round.start_at)}
                </div>

                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.65)", lineHeight: 1.35 }} className="truncate">
                  {configLine || " "}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={kvRow}>
                    <span style={kvKey}>Slope</span>
                    <span style={kvVal}>{typeof round.slope_rating === "number" ? round.slope_rating : "—"}</span>
                  </div>

                  <div style={kvRow}>
                    <span style={kvKey}>Course rating</span>
                    <span style={kvVal}>{typeof round.course_rating === "number" ? round.course_rating : "—"}</span>
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.60)" }}>Score</div>
                <div style={{ fontWeight: 1200, fontSize: 44, lineHeight: 0.95 }}>{computed.scoreTotal ?? "—"}</div>
                <div style={{ fontSize: 14, fontWeight: 950, color: "rgba(0,0,0,0.62)", marginTop: 2 }}>
                  {diffLabel ? `(${diffLabel})` : " "}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Holes list */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ display: "grid", gap: 10 }}>
              {holes.map((h) => {
                const gir = isGIR(h.par, h.score, h.putts);
                const girKnown = h.par != null && h.score != null && h.putts != null;

                const fwKnown = h.fairway_hit !== null;
                const fwHit = h.fairway_hit === true;
                const fwMiss = h.fairway_hit === false;

                return (
                  <Link
                    key={h.id ?? `h-${h.hole_no}`}
                    href={`/player/golf/rounds/${round.id}/edit?hole=${h.hole_no}`}
                    style={{ display: "block" }}
                  >
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
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                        <div style={{ fontWeight: 1000, fontSize: 16 }}>Trou {h.hole_no}</div>

                        <div style={{ justifySelf: "end" }}>
                          <ScoreShape value={h.score} mark={scoreMark(h.par, h.score)} />
                        </div>
                      </div>

                      {/* ✅ chips/pills */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span style={pillGrey}>Par {h.par ?? "—"}</span>

                        <span
                          style={
                            !fwKnown
                              ? pillGrey
                              : fwHit
                              ? pillGreen
                              : pillRed
                          }
                        >
                          FW {!fwKnown ? "—" : fwHit ? "Hit" : "Miss"}
                        </span>

                        <span
                          style={
                            !girKnown
                              ? pillGrey
                              : gir
                              ? pillGreen
                              : pillRed
                          }
                        >
                          GIR {!girKnown ? "—" : gir ? "Oui" : "Non"}
                        </span>
                      </div>

                      {!!h.note?.trim() && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>{h.note.trim()}</div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 1000, fontSize: 16 }}>Statistiques</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={statBox}>
                <div style={statLabel}>Eagles</div>
                <div style={statValue}>{computed.eagles ?? 0}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>Birdies</div>
                <div style={statValue}>{computed.birdies ?? 0}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>Pars</div>
                <div style={statValue}>{computed.pars ?? 0}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>Bogeys</div>
                <div style={statValue}>{computed.bogeys ?? 0}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={statBox}>
                <div style={statLabel}>Double bogey +</div>
                <div style={statValue}>{computed.doublesPlus ?? 0}</div>
              </div>

              <div style={statBox}>
                <div style={statLabel}>Double bogey</div>
                <div style={statValue}>{computed.doubleBogeys ?? 0}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={statBox}>
                <div style={statLabel}>GIR</div>
                <div style={statValue}>{typeof computed.gir === "number" ? computed.gir : "—"}</div>
              </div>

              <div style={statBox}>
                <div style={statLabel}>Putts</div>
                <div style={statValue}>{typeof computed.putts === "number" ? computed.putts : "—"}</div>
              </div>
            </div>

            {typeof computed.scoreTotal === "number" && (
              <div style={statBox}>
                <div style={statLabel}>Score total</div>
                <div style={statValue}>{computed.scoreTotal}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ✅ If you prefer CSS classes instead of inline styles:
 * - replace pillGrey/pillGreen/pillRed with className like:
 *   className="pill pill--grey" / "pill pill--green" / "pill pill--red"
 * and define them in globals.css.
 */

const kvRow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.10)",
  background: "rgba(255,255,255,0.55)",
};

const kvKey: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "rgba(0,0,0,0.55)",
};

const kvVal: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 1100,
  color: "rgba(0,0,0,0.82)",
};

const pillBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 28,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.10)",
  fontSize: 12,
  fontWeight: 950,
  color: "rgba(0,0,0,0.78)",
};

const pillGrey: React.CSSProperties = {
  ...pillBase,
  background: "rgba(0,0,0,0.06)",
};

const pillGreen: React.CSSProperties = {
  ...pillBase,
  background: "rgba(21,128,61,0.18)",
  borderColor: "rgba(21,128,61,0.22)",
};

const pillRed: React.CSSProperties = {
  ...pillBase,
  background: "rgba(185,28,28,0.16)",
  borderColor: "rgba(185,28,28,0.22)",
};

const statBox: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.10)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.65)",
  padding: 12,
  display: "grid",
  gap: 6,
};

const statLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.62)",
};

const statValue: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 1000,
  color: "rgba(0,0,0,0.85)",
};