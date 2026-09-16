import test from "node:test";
import assert from "node:assert/strict";
import { calculateGolfRoundMetrics, scoreToParLabel, validateGolfHoles } from "../lib/golfRoundMetrics.ts";

const makeHoles = (count: number) => Array.from({ length: count }, (_, index) => ({
  hole_no: index + 1, par: 4, score: 4, putts: 2, fairway_hit: index % 2 === 0,
}));

test("calcule une partie complète de 9 trous", () => {
  const result = calculateGolfRoundMetrics(makeHoles(9), 9);
  assert.equal(result.complete, true);
  assert.equal(result.score, 36);
  assert.equal(result.toPar, 0);
  assert.equal(result.front.played, 9);
  assert.equal(result.back.played, 0);
});

test("calcule les totaux aller, retour et total sur 18 trous", () => {
  const holes = makeHoles(18).map((hole) => hole.hole_no === 10 ? { ...hole, score: 5 } : hole);
  const result = calculateGolfRoundMetrics(holes, 18);
  assert.deepEqual([result.front.score, result.back.score, result.score], [36, 37, 73]);
  assert.equal(result.toPar, 1);
  assert.equal(scoreToParLabel(result.toPar), "+1");
});

test("préserve les statistiques partielles d'une partie incomplète", () => {
  const holes = makeHoles(18).map((hole) => hole.hole_no > 6 ? { ...hole, score: null, putts: null, fairway_hit: null } : hole);
  const result = calculateGolfRoundMetrics(holes, 18);
  assert.equal(result.complete, false);
  assert.equal(result.playedHoles, 6);
  assert.equal(result.putts.total, 12);
  assert.equal(result.gir.opportunities, 6);
});

test("classe les résultats et ignore les valeurs nulles", () => {
  const holes = makeHoles(9);
  holes[0].score = 2;
  holes[1].score = 3;
  holes[2].score = 5;
  holes[3].score = 6;
  holes[4].score = null as unknown as number;
  const result = calculateGolfRoundMetrics(holes, 9);
  assert.deepEqual(result.distribution, { eagleOrBetter: 1, birdie: 1, par: 4, bogey: 1, doubleOrWorse: 1 });
});

test("valide la grille sans imposer les trous encore vides", () => {
  const holes = makeHoles(18);
  holes[4].putts = 8;
  holes[4].score = 5;
  holes[10].score = 31;
  const errors = validateGolfHoles(holes, 18);
  assert.deepEqual(Object.keys(errors), ["5", "11"]);
});
