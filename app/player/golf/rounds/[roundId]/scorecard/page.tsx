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
    <div style={{ fontWeight: 1000, fontSize: 22, lineHeight: 1, minWidth: 22, textAlign: "center" }}>{txt}</div>
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
        "id,start_at,round_type,competition_name,course_name,tee_name,total_score,total_putts,gir,eagles,birdies,pars,bogeys,doubles_plus"
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

  const stats = useMemo(() => {
    const filled = holes.filter((h) => typeof h.par === "number" && typeof h.score === "number");

    let eagles = 0,
      birdies = 0,
      pars = 0,
      bogeys = 0,
      doublesPlus = 0;

    let girCount = 0;
    let puttsTotal = 0;

    filled.forEach((h) => {
      const d = (h.score as number) - (h.par as number);
      if (d <= -2) eagles++;
      else if (d === -1) birdies++;
      else if (d === 0) pars++;
      else if (d === 1) bogeys++;
      else if (d >= 2) doublesPlus++;

      if (isGIR(h.par, h.score, h.putts)) girCount++;
      if (typeof h.putts === "number") puttsTotal += h.putts;
    });

    const holesPlayed = filled.length;
    return { eagles, birdies, pars, bogeys, doublesPlus, girCount, holesPlayed, puttsTotal };
  }, [holes]);

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

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Carte de scores
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link
                className="cta-green cta-green-inline"
                href={`/player/golf/rounds/${round.id}/edit`}
              >
                Modifier
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/rounds">
                Mes parcours
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Holes list */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ display: "grid", gap: 10 }}>
              {holes.map((h) => {
                const gir = isGIR(h.par, h.score, h.putts);
                const fw = h.fairway_hit == null ? "—" : h.fairway_hit ? "Hit" : "Miss";

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
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontWeight: 1000, fontSize: 16 }}>Trou {h.hole_no}</div>

                        <div style={{ justifySelf: "end" }}>
                          <ScoreShape value={h.score} mark={scoreMark(h.par, h.score)} />
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span style={pillSm}>Par {h.par ?? "—"}</span>
                        <span style={pillSm}>FW {fw}</span>
                        <span style={pillSm}>
                          GIR {h.par == null || h.score == null || h.putts == null ? "—" : gir ? "Oui" : "Non"}
                        </span>
                      </div>

                      {!!h.note?.trim() && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                          {h.note.trim()}
                        </div>
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
                <div style={statValue}>{round.eagles ?? stats.eagles}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>Birdies</div>
                <div style={statValue}>{round.birdies ?? stats.birdies}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>Pars</div>
                <div style={statValue}>{round.pars ?? stats.pars}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>Bogeys</div>
                <div style={statValue}>{round.bogeys ?? stats.bogeys}</div>
              </div>
            </div>

            <div style={statBox}>
              <div style={statLabel}>Double bogey +</div>
              <div style={statValue}>{round.doubles_plus ?? stats.doublesPlus}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={statBox}>
                <div style={statLabel}>GIR</div>
                <div style={statValue}>
                  {typeof round.gir === "number"
                    ? round.gir
                    : `${stats.girCount}${stats.holesPlayed ? ` / ${stats.holesPlayed}` : ""}`}
                </div>
              </div>

              <div style={statBox}>
                <div style={statLabel}>Putts</div>
                <div style={statValue}>{round.total_putts ?? stats.puttsTotal}</div>
              </div>
            </div>

            {typeof round.total_score === "number" && (
              <div style={statBox}>
                <div style={statLabel}>Score total</div>
                <div style={statValue}>{round.total_score}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const pillSm: React.CSSProperties = {
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.10)",
  background: "rgba(255,255,255,0.72)",
  fontWeight: 900,
  fontSize: 12,
  color: "rgba(0,0,0,0.78)",
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