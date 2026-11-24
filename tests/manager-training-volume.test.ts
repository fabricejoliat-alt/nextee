import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";
const { managerTrainingVolumeSeries } = loadManagerModule<typeof import("../lib/managerTrainingVolume.ts")>("lib/managerTrainingVolume.ts", {});
const objective = {
  seasonMonths: [9], currentHandicap: 20, handicapHistory: [],
  targets: [{ ftem_code: "T1", level_label: "QA", handicap_min: 15, handicap_max: 36, minutes_offseason: 0, minutes_inseason: 300 }],
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
  assert.deepEqual(rows.map(row => row.objective), [60, 70, 10]);
  assert.equal(rows[2].other, 15);
});

test("FTEM is prorated from monthly settings across a season boundary and handicap change", () => {
  const config = { ...objective, seasonMonths: [10], targets: [{ ...objective.targets[0], minutes_offseason: 300, minutes_inseason: 620 }] };
  const boundary = managerTrainingVolumeSeries({ from: "2026-09-30", to: "2026-10-02" }, [], config);
  assert.equal(boundary[0].objective, 50);
  const changed = managerTrainingVolumeSeries({ from: "2026-09-01", to: "2026-09-14" }, [], {
    ...objective, handicapHistory: [{ effectiveDate: "2026-09-08", value: 10 }],
    targets: [...objective.targets, { ...objective.targets[0], ftem_code: "T2", handicap_min: 0, handicap_max: 14.9, minutes_inseason: 600 }],
  });
  assert.deepEqual(changed.map(row => row.objective), [60, 130, 20]);
});

test("missing FTEM settings leave the reference unknown instead of inventing a target", () => {
  const rows = managerTrainingVolumeSeries({ from: "2026-09-01", to: "2026-09-14" }, [], { ...objective, targets: [] });
  assert.ok(rows.every(row => row.objective === null && row.total === 0));
});
