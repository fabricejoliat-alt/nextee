export type GolfHoleInput = {
  hole_no: number;
  par: number | null;
  score: number | null;
  putts?: number | null;
  fairway_hit?: boolean | null;
};

export type GolfScoreCategory = "eagleOrBetter" | "birdie" | "par" | "bogey" | "doubleOrWorse";

export type GolfRoundMetrics = {
  expectedHoles: 9 | 18;
  playedHoles: number;
  complete: boolean;
  score: number | null;
  par: number | null;
  toPar: number | null;
  front: { score: number | null; par: number | null; toPar: number | null; played: number };
  back: { score: number | null; par: number | null; toPar: number | null; played: number };
  putts: { total: number | null; average: number | null; known: number };
  fairways: { hit: number; opportunities: number; percentage: number | null };
  gir: { hit: number; opportunities: number; percentage: number | null };
  scrambling: { made: number; opportunities: number; percentage: number | null };
  distribution: Record<GolfScoreCategory, number>;
  bestHole: GolfHoleInput | null;
  worstHole: GolfHoleInput | null;
};

const percent = (value: number, total: number) => total > 0 ? Math.round((value / total) * 1000) / 10 : null;
const sumOrNull = (values: Array<number | null | undefined>) => {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

export function scoreToParLabel(value: number | null) {
  if (value == null) return "—";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

export function getScoreCategory(par: number | null, score: number | null): GolfScoreCategory | null {
  if (typeof par !== "number" || typeof score !== "number") return null;
  const delta = score - par;
  if (delta <= -2) return "eagleOrBetter";
  if (delta === -1) return "birdie";
  if (delta === 0) return "par";
  if (delta === 1) return "bogey";
  return "doubleOrWorse";
}

export function isGir(hole: GolfHoleInput) {
  return typeof hole.par === "number" && typeof hole.score === "number" && typeof hole.putts === "number"
    ? hole.score - hole.putts <= hole.par - 2
    : null;
}

function sideMetrics(holes: GolfHoleInput[]) {
  const played = holes.filter((hole) => typeof hole.score === "number");
  const comparable = holes.filter((hole) => typeof hole.score === "number" && typeof hole.par === "number");
  const score = sumOrNull(played.map((hole) => hole.score));
  const par = sumOrNull(comparable.map((hole) => hole.par));
  return { score, par, toPar: score != null && par != null ? score - par : null, played: played.length };
}

export function calculateGolfRoundMetrics(input: GolfHoleInput[], expectedHoles?: 9 | 18): GolfRoundMetrics {
  const holes = [...input].sort((a, b) => a.hole_no - b.hole_no);
  const inferredExpected: 9 | 18 = expectedHoles ?? (holes.some((hole) => hole.hole_no > 9) ? 18 : 9);
  const played = holes.filter((hole) => typeof hole.score === "number");
  const comparable = played.filter((hole) => typeof hole.par === "number");
  const score = sumOrNull(played.map((hole) => hole.score));
  const par = sumOrNull(comparable.map((hole) => hole.par));

  const distribution: GolfRoundMetrics["distribution"] = {
    eagleOrBetter: 0, birdie: 0, par: 0, bogey: 0, doubleOrWorse: 0,
  };
  comparable.forEach((hole) => {
    const category = getScoreCategory(hole.par, hole.score);
    if (category) distribution[category] += 1;
  });

  const puttsKnown = played.filter((hole) => typeof hole.putts === "number");
  const totalPutts = sumOrNull(puttsKnown.map((hole) => hole.putts));
  const fairwayKnown = played.filter((hole) => (hole.par ?? 0) > 3 && typeof hole.fairway_hit === "boolean");
  const fairwaysHit = fairwayKnown.filter((hole) => hole.fairway_hit).length;
  const girKnown = played.map((hole) => ({ hole, gir: isGir(hole) })).filter((item) => item.gir != null);
  const girHit = girKnown.filter((item) => item.gir).length;
  const scrambleOpportunities = girKnown.filter((item) => !item.gir);
  const scramblingMade = scrambleOpportunities.filter(({ hole }) =>
    typeof hole.score === "number" && typeof hole.par === "number" && hole.score <= hole.par
  ).length;

  const ranked = comparable.map((hole) => ({ hole, delta: (hole.score as number) - (hole.par as number) }));
  ranked.sort((a, b) => a.delta - b.delta || a.hole.hole_no - b.hole.hole_no);

  return {
    expectedHoles: inferredExpected,
    playedHoles: played.length,
    complete: played.length >= inferredExpected,
    score,
    par,
    toPar: score != null && par != null ? score - par : null,
    front: sideMetrics(holes.filter((hole) => hole.hole_no <= 9)),
    back: sideMetrics(holes.filter((hole) => hole.hole_no > 9)),
    putts: { total: totalPutts, average: totalPutts != null ? Math.round((totalPutts / puttsKnown.length) * 100) / 100 : null, known: puttsKnown.length },
    fairways: { hit: fairwaysHit, opportunities: fairwayKnown.length, percentage: percent(fairwaysHit, fairwayKnown.length) },
    gir: { hit: girHit, opportunities: girKnown.length, percentage: percent(girHit, girKnown.length) },
    scrambling: { made: scramblingMade, opportunities: scrambleOpportunities.length, percentage: percent(scramblingMade, scrambleOpportunities.length) },
    distribution,
    bestHole: ranked[0]?.hole ?? null,
    worstHole: ranked[ranked.length - 1]?.hole ?? null,
  };
}

export function validateGolfHoles(holes: GolfHoleInput[], expectedHoles: 9 | 18) {
  const errors: Record<number, string[]> = {};
  for (const hole of holes.filter((item) => item.hole_no <= expectedHoles)) {
    const messages: string[] = [];
    if (hole.par != null && (hole.par < 1 || hole.par > 7)) messages.push("Par invalide");
    if (hole.score != null && (hole.score < 1 || hole.score > 30)) messages.push("Score invalide");
    if (hole.putts != null && (hole.putts < 0 || hole.putts > 10 || (hole.score != null && hole.putts > hole.score))) messages.push("Putts invalides");
    if (messages.length) errors[hole.hole_no] = messages;
  }
  return errors;
}
