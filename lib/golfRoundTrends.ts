import type { GolfHoleInput } from "./golfRoundMetrics.ts";

type TrendRound = {
  id: string; course_name?: string | null; tee_name?: string | null;
  om_competition_format?: string | null;
};
export type Trend = {
  count: number; rounds: number; difference: number | null;
  direction: "better" | "worse" | "uncertain" | "insufficient";
  pValue: number;
};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const valid = (hole: GolfHoleInput) => Number.isInteger(hole.hole_no) && hole.hole_no >= 1 && hole.hole_no <= 18
  && Number.isInteger(hole.par) && hole.par! >= 1 && hole.par! <= 7
  && Number.isInteger(hole.score) && hole.score! >= 1 && hole.score! <= 30;
const delta = (hole: GolfHoleInput) => hole.score! - hole.par!;

// Exact two-sided paired sign test, excluding ties (NIST sign test).
// Log probabilities keep the binomial tail stable for large histories.
function signPValue(values: number[]) {
  const nonzero = values.filter(value => Math.abs(value) > 1e-9);
  const n = nonzero.length;
  if (!n) return 1;
  const positive = nonzero.filter(value => value > 0).length;
  const k = Math.min(positive, n - positive);
  let logTerm = -n * Math.LN2;
  let logSum = logTerm;
  for (let i = 1; i <= k; i++) {
    logTerm += Math.log(n - i + 1) - Math.log(i);
    const max = Math.max(logSum, logTerm);
    logSum = max + Math.log(Math.exp(logSum - max) + Math.exp(logTerm - max));
  }
  return Math.min(1, 2 * Math.exp(logSum));
}
function summarize(values: number[], count: number, minimumCount: number, minimumEffect: number): Trend {
  const difference = values.length ? mean(values) : null;
  const pValue = signPValue(values);
  const insufficient = values.length < 8 || count < minimumCount;
  const consistent = difference != null && Math.sign(difference) === Math.sign(values.filter(v => v > 1e-9).length - values.filter(v => v < -1e-9).length);
  return { count, rounds: values.length, difference, pValue,
    direction: insufficient ? "insufficient" : pValue < .05 && consistent && Math.abs(difference!) >= minimumEffect
      ? difference! < 0 ? "better" : "worse" : "uncertain" };
}

export function calculateGolfRoundTrends(rounds: TrendRound[], holesByRound: Record<string, GolfHoleInput[]>) {
  const eligible = rounds.filter(round => round.om_competition_format !== "match_play_individual");
  const holes = new Map(eligible.map(round => {
    const rows = holesByRound[round.id] ?? [];
    // Ambiguous duplicate hole numbers are not evidence.
    const unique = rows.filter(hole => valid(hole) && rows.filter(other => other.hole_no === hole.hole_no).length === 1);
    return [round.id, new Map(unique.map(hole => [hole.hole_no, hole]))];
  }));
  const sides: number[] = [];
  const frontScores: number[] = [], backScores: number[] = [];
  for (const round of eligible) {
    const rows = holes.get(round.id)!;
    if (rows.size !== 18) continue;
    const front = [...rows.values()].filter(h => h.hole_no <= 9).reduce((sum, h) => sum + delta(h), 0);
    const back = [...rows.values()].filter(h => h.hole_no > 9).reduce((sum, h) => sum + delta(h), 0);
    frontScores.push(front); backScores.push(back); sides.push(back - front);
  }
  const afterByRound: number[] = [];
  let opportunities = 0, parOrBetter = 0;
  for (const round of eligible) {
    if (!round.course_name?.trim() || !round.tee_name?.trim()) continue;
    const rows = holes.get(round.id)!;
    const effects: number[] = [];
    for (const hole of rows.values()) {
      if (delta(hole) > -1) continue;
      const next = rows.get(hole.hole_no + 1);
      if (!next) continue; // Never cross a missing hole or a round boundary.
      const baseline: number[] = [];
      for (const other of eligible) {
        if (other.id === round.id || other.course_name !== round.course_name || other.tee_name !== round.tee_name) continue;
        const reference = holes.get(other.id)!.get(next.hole_no);
        const previous = holes.get(other.id)!.get(hole.hole_no);
        if (reference && previous && reference.par === next.par && delta(previous) >= 0) baseline.push(delta(reference));
      }
      if (baseline.length < 3) continue;
      effects.push(delta(next) - mean(baseline));
      opportunities++;
      if (delta(next) <= 0) parOrBetter++;
    }
    // One observation per round avoids treating consecutive holes as independent.
    if (effects.length) afterByRound.push(mean(effects));
  }
  return {
    sides: { ...summarize(sides, sides.length, 8, 1), frontAverage: frontScores.length ? mean(frontScores) : null, backAverage: backScores.length ? mean(backScores) : null },
    afterBirdie: { ...summarize(afterByRound, opportunities, 10, .2), parOrBetter },
  };
}
