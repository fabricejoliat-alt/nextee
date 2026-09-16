import test from "node:test";
import assert from "node:assert/strict";
import { attendanceTrend, calculateActivityAndCoachHours, isAssiduous, median, PERFORMANCE_THRESHOLDS } from "../lib/managerPerformance.ts";

test("la médiane résiste aux volumes extrêmes", () => { assert.equal(median([10, 12, 14, 16, 900]), 14); assert.equal(median([]), null); });
test("un junior assidu respecte le taux et l’échantillon minimum", () => { assert.equal(isAssiduous({ rate: 90, denominator: 5 }), true); assert.equal(isAssiduous({ rate: 100, denominator: 4 }), false); });
test("une baisse d’assiduité exige deux échantillons suffisants", () => {
  assert.deepEqual(attendanceTrend({ rate: 70, denominator: 5 }, { rate: 90, denominator: 5 }), { status: "down", change: -20 });
  assert.equal(attendanceTrend({ rate: 50, denominator: 2 }, { rate: 90, denominator: 5 }).status, "insufficient");
  assert.equal(PERFORMANCE_THRESHOLDS.attendanceDropPoints, 15);
});
test("les heures d’activité ne doublent pas un événement multi-coachs", () => {
  const events = [{ id: "e", startsAt: "2026-09-01T08:00:00Z", endsAt: "2026-09-01T10:00:00Z" }];
  const result = calculateActivityAndCoachHours(events, [{ eventId: "e", coachId: "a" }, { eventId: "e", coachId: "b" }]);
  assert.deepEqual(result, { activityHours: 2, coachHours: 4 });
});
