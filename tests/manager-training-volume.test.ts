import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";
const { managerTrainingVolumeSeries } = loadManagerModule<typeof import("../lib/managerTrainingVolume.ts")>("lib/managerTrainingVolume.ts", {});
const objective = {
  configs: [{ seasonMonths: [9], offseasonMonths: [], targets: [{ ftem_code: "T1", level_label: "QA", handicap_min: 15, handicap_max: 36, minutes_offseason: 0, minutes_inseason: 300 }] }], currentHandicap: 20, handicapHistory: [],
};

test("weekly volume preserves the selected period and counts a linked session once", () => {
  const rows = managerTrainingVolumeSeries({ from: "2026-09-01", to: "2026-09-14" }, [
    { id: "club", startAt: "2026-09-01T10:00:00Z", minutes: 60, sessionType: "club", clubEventId: "event" },
    { id: "duplicate", startAt: "2026-09-01T10:00:00Z", minutes: 60, sessionType: "club", clubEventId: "event" },
    { id: "private", startAt: "2026-09-05T10:00:00Z", minutes: 30, sessionType: "private" },
    { id: "individual", startAt: "2026-09-08T10:00:00Z", minutes: 45, sessionType: "individual" },
    { id: "legacy", startAt: "2026-09-14T10:00:00Z", minutes: 15, sessionType: null },
    { id: "outside", startAt: "2026-09-15T10:00:00Z", minutes: 900, sessionType: "club" },
  ], objective);
  assert.deepEqual(rows.map(row => row.week), ["2026-08-31", "2026-09-07", "2026-09-14"]);
  assert.deepEqual(rows.map(row => row.total), [90, 45, 15]);
  assert.deepEqual(rows.map(row => row.objective), [300, 300, 300]);
  assert.equal(rows[2].other, 15);
});

test("FTEM uses the Monday's season and historical handicap exactly as Player", () => {
  const config = { ...objective, configs: [{ ...objective.configs[0], seasonMonths: [10], offseasonMonths: [9], targets: [{ ...objective.configs[0].targets[0], minutes_offseason: 300, minutes_inseason: 620 }] }] };
  assert.equal(managerTrainingVolumeSeries({ from: "2026-09-30", to: "2026-10-02" }, [], config)[0].objective, 300);
  const changed = managerTrainingVolumeSeries({ from: "2026-09-01", to: "2026-09-14" }, [], {
    ...objective, handicapHistory: [{ effectiveDate: "2026-08-01", value: 20 }, { effectiveDate: "2026-09-08", value: 10 }],
    configs: [{ ...objective.configs[0], targets: [...objective.configs[0].targets, { ...objective.configs[0].targets[0], ftem_code: "T2", handicap_min: 0, handicap_max: 14.9, minutes_inseason: 600 }] }],
  });
  assert.deepEqual(changed.map(row => row.objective), [300, 300, 600]);
});

test("missing FTEM settings leave the reference unknown instead of inventing a target", () => {
  const rows = managerTrainingVolumeSeries({ from: "2026-09-01", to: "2026-09-14" }, [], { ...objective, configs: [] });
  assert.ok(rows.every(row => row.objective === null && row.total === 0));
});

const reference = loadManagerModule<typeof import("../lib/trainingVolumeReference.ts")>("lib/trainingVolumeReference.ts", {});
test("Player fallbacks retain the earliest historical handicap, first target and unspecified season months", () => {
  const target = objective.configs[0].targets[0];
  assert.equal(reference.pickTrainingVolumeTarget(null, [target]), target);
  assert.equal(reference.pickTrainingVolumeTarget(100, [target]), target);
  assert.equal(reference.pickTrainingVolumeTarget(20, [{ ...target, handicap_min: 36, handicap_max: 15 }])?.ftem_code, "T1");
  assert.equal(reference.trainingHandicapForDate("2026-09-01", [{ effectiveDate: "2026-10-01", value: 10 }], 20), 10);
  assert.equal(reference.objectiveForMonth(target, [9], [], 8), 300);
  assert.equal(reference.objectiveForMonth(target, [9], [8], 8), 0);
  const config = { ...objective, configs: [...objective.configs, { ...objective.configs[0], targets: [{ ...target, minutes_inseason: 600 }] }] };
  const range = { from: "2026-09-01", to: "2026-09-14" };
  assert.deepEqual(managerTrainingVolumeSeries(range, [], config).map(row => row.objective), [600, 600, 600]);
  assert.equal(reference.calculateWeeklyTrainingObjective(range, config).minutes, 1800);
});
