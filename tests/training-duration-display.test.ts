import test from "node:test";
import assert from "node:assert/strict";
import { formatTrainingDuration, trainingDurationUnit, TRAINING_DURATION_METADATA_KEY } from "../lib/trainingDurationDisplay.ts";

test("formats training volumes as hours and minutes without decimal hours", () => {
  for (const [minutes, expected] of [[0, "0h00"], [20, "0h20"], [60, "1h00"], [80, "1h20"], [10355, "172h35"], [18720, "312h00"], [8365, "139h25"]] as const) {
    assert.equal(formatTrainingDuration(minutes, "hours"), expected);
  }
});
test("retains minute display by default and for unrecognized stored settings", () => {
  assert.equal(trainingDurationUnit(null), "minutes");
  assert.equal(trainingDurationUnit({ [TRAINING_DURATION_METADATA_KEY]: "decimal" }), "minutes");
  assert.equal(formatTrainingDuration(80, "minutes"), "80 min");
  assert.equal(trainingDurationUnit({ [TRAINING_DURATION_METADATA_KEY]: "hours" }), "hours");
});
test("rounds before splitting hours and handles missing or invalid totals", () => {
  assert.equal(formatTrainingDuration(59.6, "hours"), "1h00");
  assert.equal(formatTrainingDuration(null, "hours"), "—");
  assert.equal(formatTrainingDuration(Number.NaN, "hours"), "—");
  assert.equal(formatTrainingDuration(-1, "hours"), "0h00");
});
