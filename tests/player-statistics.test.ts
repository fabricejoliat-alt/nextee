import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkMedian, calculateAttendance, calculateProratedTrainingObjective, calculateRegularity, handicapProgression, previousPeriod, uniqueTrainingRows } from "../lib/playerStatistics.ts";
import { deliveryGroupKey, nextReportDate, periodicEventTitle, previousCivilPeriod } from "../lib/periodicReports.ts";

const range = { from: "2026-09-01", to: "2026-09-30" };
test("l’assiduité exclut futur, annulé, excusé et attendu du dénominateur", () => {
  const rows = [
    { id: "1", startsAt: "2026-09-02T10:00:00Z", status: "present" },
    { id: "2", startsAt: "2026-09-03T10:00:00Z", status: "absent" },
    { id: "3", startsAt: "2026-09-04T10:00:00Z", status: "excused" },
    { id: "4", startsAt: "2026-09-05T10:00:00Z", status: "expected" },
    { id: "5", startsAt: "2026-09-06T10:00:00Z", status: "present", eventStatus: "cancelled" },
    { id: "6", startsAt: "2026-10-02T10:00:00Z", status: "present" },
  ];
  const result = calculateAttendance(rows, range, new Date("2026-10-01T00:00:00Z"));
  assert.equal(result.rate, 50); assert.equal(result.excused, 1); assert.equal(result.pending, 1); assert.equal(result.denominator, 2);
});
test("la régularité adapte les semaines partielles", () => {
  const result = calculateRegularity([{ id: "a", startAt: "2026-09-02T10:00:00Z", minutes: 30 }, { id: "b", startAt: "2026-09-15T10:00:00Z", minutes: 20 }], { from: "2026-09-01", to: "2026-09-16" });
  assert.equal(result.totalWeeks, 3); assert.equal(result.activeWeeks, 2); assert.equal(result.rate, 66.7);
});
test("les séances liées au même événement ne sont pas comptées deux fois", () => {
  const result = uniqueTrainingRows([{ id: "a", startAt: "2026-09-01", minutes: 30, clubEventId: "event" }, { id: "b", startAt: "2026-09-01", minutes: 30, clubEventId: "event" }, { id: "c", startAt: "2026-09-02", minutes: 20 }]);
  assert.equal(result.length, 2);
});
test("la médiane collective exige cinq juniors", () => {
  assert.equal(benchmarkMedian([1, 2, 3, 4]).available, false); assert.equal(benchmarkMedian([1, 2, 3, 4, 100]).value, 3);
});
test("une baisse de handicap est une progression positive", () => {
  const result = handicapProgression([{ effectiveDate: "2026-09-01", value: 18.2 }, { effectiveDate: "2026-09-20", value: 16.9 }], range, 16.9);
  assert.equal(result.change, 1.3); assert.equal(result.best, 16.9);
});
test("la comparaison précédente conserve la durée", () => { assert.deepEqual(previousPeriod({ from: "2026-09-10", to: "2026-09-12" }), { from: "2026-09-07", to: "2026-09-09" }); });
test("l’objectif FTEM suit les mois et un changement de handicap", () => {
  const result = calculateProratedTrainingObjective({ range: { from: "2026-03-31", to: "2026-04-02" }, seasonMonths: [4], currentHandicap: 20, handicapHistory: [{ effectiveDate: "2026-04-02", value: 10 }], targets: [{ ftem_code: "F3", level_label: "Explorer", handicap_min: 18.1, handicap_max: 36, minutes_offseason: 310, minutes_inseason: 300 }, { ftem_code: "T2", level_label: "Challenger", handicap_min: 5.1, handicap_max: 10, minutes_offseason: 620, minutes_inseason: 600 }] });
  assert.equal(result.minutes, 40); assert.equal(result.ftemCode, "T2");
});
test("les périodes civiles mensuelles, trimestrielles et semestrielles sont complètes", () => {
  const now = new Date("2026-09-11T10:00:00Z");
  assert.deepEqual(previousCivilPeriod("monthly", now), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(previousCivilPeriod("quarterly", now), { from: "2026-04-01", to: "2026-06-30" });
  assert.deepEqual(previousCivilPeriod("semiannual", now), { from: "2026-01-01", to: "2026-06-30" });
});
test("le regroupement sépare langue, fréquence, période et date", () => {
  const base = { recipientId: "p", frequency: "monthly" as const, period: range, sendAt: "2026-10-05T08:00:00Z", locale: "fr" };
  assert.notEqual(deliveryGroupKey(base), deliveryGroupKey({ ...base, locale: "de" }));
  assert.notEqual(deliveryGroupKey(base), deliveryGroupKey({ ...base, frequency: "quarterly" }));
  assert.notEqual(deliveryGroupKey(base), deliveryGroupKey({ ...base, sendAt: "2026-10-06T08:00:00Z" }));
  assert.equal(deliveryGroupKey(base), deliveryGroupKey({ ...base }));
});
test("la prochaine échéance respecte les rythmes mensuel, trimestriel et semestriel", () => {
  const now = new Date("2026-09-11T10:00:00Z");
  assert.equal(nextReportDate("monthly", 5, now).slice(0, 10), "2026-10-05");
  assert.equal(nextReportDate("quarterly", 5, now).slice(0, 10), "2026-12-05");
  assert.equal(nextReportDate("semiannual", 5, now).slice(0, 10), "2027-03-05");
});

test("les activités sans titre utilisent leur type traduit", () => {
  assert.equal(periodicEventTitle(null, "training", "fr"), "Entraînement");
  assert.equal(periodicEventTitle("  ", "competition", "fr"), "Compétition");
  assert.equal(periodicEventTitle("Putting", "training", "fr"), "Putting");
  assert.equal(periodicEventTitle(null, null, "fr"), "Événement");
});
