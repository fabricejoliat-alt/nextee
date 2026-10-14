import assert from "node:assert/strict";
import test from "node:test";
import { trainingPlanCompletion } from "../lib/trainingPlanCompletion.ts";

const item = (category: string, minutes: number) => ({ category, minutes });

test("extra time in a planned sector caps completion at 100%, with unrelated sectors excluded", () => {
  for (const minutes of [10, 20, 30, 90]) {
    const result = trainingPlanCompletion([item("warmup_mobility", 10)], [item("warmup_mobility", minutes), item("putting", 60)]);
    assert.equal(result.percent, 100);
    assert.equal(result.creditedMinutes, 10);
  }
  assert.equal(trainingPlanCompletion([item("warmup_mobility", 10)], [item("putting", 90)]).percent, 0);
});

test("the user's two completed posts produce 100%, regardless of extra actual minutes", () => {
  const result = trainingPlanCompletion([item("warmup_mobility", 10), item("long_game", 30)], [item("warmup_mobility", 30), item("long_game", 60)]);
  assert.equal(result.percent, 100);
  assert.equal(result.creditedMinutes, 40);
});

test("100% of ten minutes plus 50% of sixty minutes means 40/70 planned minutes, or 57%", () => {
  const result = trainingPlanCompletion([item("warmup_mobility", 10), item("long_game", 60)], [item("warmup_mobility", 20), item("long_game", 30)]);
  assert.equal(result.percent, 57);
  assert.deepEqual(result.sectors.map(sector => sector.percent), [100, 50]);
  assert.equal(result.creditedMinutes, 40);
});

test("missing and partial sectors remain weighted by their planned time", () => {
  const result = trainingPlanCompletion([item("warmup_mobility", 10), item("long_game", 60), item("putting", 25), item("wedging", 20)],
    [item("warmup_mobility", 20), item("long_game", 30), item("putting", 20)]);
  assert.deepEqual(result.sectors.map(sector => sector.percent), [100, 50, 80, 0]);
  assert.equal(result.percent, 52);
});

test("repeated planned and actual posts never double count time", () => {
  const result = trainingPlanCompletion([item("putting", 10), item("putting", 20)], [item("putting", 5), item("putting", 10)]);
  assert.equal(result.percent, 50);
  assert.equal(result.creditedMinutes, 15);
});

test("an empty or invalid plan has no completion percentage", () => {
  assert.equal(trainingPlanCompletion([], [item("long_game", 90)]).percent, null);
  assert.equal(trainingPlanCompletion([item("putting", 0), item("wedging", Number.NaN), item("course", -20)], []).percent, null);
});
