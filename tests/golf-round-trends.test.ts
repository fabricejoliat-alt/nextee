import test from "node:test";
import assert from "node:assert/strict";
import { calculateGolfRoundTrends } from "../lib/golfRoundTrends.ts";

const card = (back = 0) => Array.from({ length: 18 }, (_, i) => ({ hole_no: i + 1, par: 4, score: 4 + (i >= 9 ? back : 0) }));
const rounds = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), course_name: "Sion", tee_name: "Jaune" }));

test("requires eight complete cards and compares to par rather than raw score", () => {
  const rs = rounds(8);
  const hs = Object.fromEntries(rs.map(r => [r.id, card(1)]));
  assert.equal(calculateGolfRoundTrends(rs.slice(0, 7), hs).sides.direction, "insufficient");
  const result = calculateGolfRoundTrends(rs, hs).sides;
  assert.equal(result.direction, "worse");
  assert.equal(result.difference, 9);
  assert.ok(Math.abs(result.pValue - 2 / 256) < 1e-12);
  hs["0"][17].score = null as unknown as number;
  assert.equal(calculateGolfRoundTrends(rs, hs).sides.count, 7);
  const differentPars = Object.fromEntries(rs.map(r => [r.id, card().map(h => h.hole_no > 9 ? { ...h, par: 5, score: 5 } : h)]));
  assert.equal(calculateGolfRoundTrends(rs, differentPars).sides.direction, "uncertain");
});

test("does not mistake mixed results, small effects or duplicate holes for a trend", () => {
  const rs = rounds(8);
  const mixed = Object.fromEntries(rs.map((r, i) => [r.id, card(i < 4 ? 1 : -1)]));
  assert.equal(calculateGolfRoundTrends(rs, mixed).sides.direction, "uncertain");
  const small = Object.fromEntries(rs.map(r => [r.id, card().map(h => h.hole_no === 10 ? { ...h, score: 5 } : h)]));
  assert.equal(calculateGolfRoundTrends(rs, small).sides.direction, "worse");
  small["0"].push(small["0"][0]);
  assert.equal(calculateGolfRoundTrends(rs, small).sides.count, 7);
});

function momentum(score: number) {
  const rs = rounds(11);
  const hs = Object.fromEntries(rs.map((r, i) => [r.id, card().map(h => i < 8 && (h.hole_no === 1 || h.hole_no === 4)
    ? { ...h, score: 3 } : i < 8 && (h.hole_no === 2 || h.hole_no === 5) ? { ...h, score } : h)]));
  return { rs, hs };
}

test("next-hole momentum uses same-hole references and one observation per round", () => {
  const { rs, hs } = momentum(5);
  const result = calculateGolfRoundTrends(rs, hs).afterBirdie;
  assert.equal(result.direction, "worse");
  assert.equal(result.count, 16);
  assert.equal(result.rounds, 8);
  assert.equal(result.difference, 1);
  assert.equal(result.parOrBetter, 0);
  assert.ok(Math.abs(result.pValue - 2 / 256) < 1e-12);
  assert.equal(calculateGolfRoundTrends(momentum(3).rs, momentum(3).hs).afterBirdie.direction, "better");
  assert.equal(calculateGolfRoundTrends(momentum(4).rs, momentum(4).hs).afterBirdie.direction, "uncertain");
});

test("requires reference rounds with the same tee and par and sufficient independent rounds", () => {
  const { rs, hs } = momentum(5);
  rs[10].tee_name = "Rouge";
  assert.equal(calculateGolfRoundTrends(rs, hs).afterBirdie.count, 0);
  rs[10].tee_name = "Jaune";
  hs["10"][1].par = 5;
  hs["10"][1].score = 5;
  assert.equal(calculateGolfRoundTrends(rs, hs).afterBirdie.count, 8);
  assert.equal(calculateGolfRoundTrends(rs, hs).afterBirdie.direction, "insufficient");
  const subset = rs.filter(r => r.id !== "0");
  assert.equal(calculateGolfRoundTrends(subset, hs).afterBirdie.direction, "insufficient");
});

test("excludes match play, missing next holes, final holes and invalid scores", () => {
  const { rs, hs } = momentum(5);
  for (const r of rs.slice(0, 8)) {
    hs[r.id] = hs[r.id].filter(h => h.hole_no !== 2);
    hs[r.id][hs[r.id].length - 1].score = 2; // eagle on 18 has no successor
    const fifth = hs[r.id].find(h => h.hole_no === 5)!;
    fifth.score = 0;
  }
  assert.equal(calculateGolfRoundTrends(rs, hs).afterBirdie.count, 0);
  const data = momentum(5);
  const match = data.rs.map(r => ({ ...r, om_competition_format: "match_play_individual" }));
  const result = calculateGolfRoundTrends(match, data.hs);
  assert.equal(result.sides.count, 0);
  assert.equal(result.afterBirdie.count, 0);
});

test("large history remains numerically stable", () => {
  const rs = rounds(1200);
  const hs = Object.fromEntries(rs.map((r, i) => [r.id, card(i % 2 ? 1 : -1)]));
  const result = calculateGolfRoundTrends(rs, hs).sides;
  assert.equal(result.direction, "uncertain");
  assert.ok(result.pValue > .99);
});
