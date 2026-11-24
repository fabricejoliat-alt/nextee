import test from "node:test";
import assert from "node:assert/strict";
import { resolvePlayerStatisticsScope, statisticsRowInScope } from "../lib/playerStatisticsScope.ts";
import { uniqueTrainingRows } from "../lib/playerStatistics.ts";

const organizations = [
  { id: "sion", name: "Golf Club de Sion", org_type: "club" as const },
  { id: "valais", name: "Cadre Valais", org_type: "academy" as const },
];

test("statistics default to the current structure and reject an unavailable affiliation", () => {
  assert.deepEqual(resolvePlayerStatisticsScope("current", "sion", organizations)?.organizationIds, ["sion"]);
  assert.deepEqual(resolvePlayerStatisticsScope("valais", "sion", organizations)?.organizationIds, ["valais"]);
  assert.equal(resolvePlayerStatisticsScope("other", "sion", organizations), null);
  assert.equal(resolvePlayerStatisticsScope("all", "sion", []), null);
});

test("combined statistics merge actual sessions once rather than adding percentages or duplicating personal practice", () => {
  const ids = resolvePlayerStatisticsScope("all", "sion", organizations)!.organizationIds;
  const rows = [
    { id: "club", clubId: "sion", startAt: "2026-11-01", minutes: 60, clubEventId: "event-sion" },
    { id: "club-copy", clubId: "sion", startAt: "2026-11-01", minutes: 60, clubEventId: "event-sion" },
    { id: "academy", clubId: "valais", startAt: "2026-11-02", minutes: 90, clubEventId: "event-valais" },
    { id: "personal", clubId: null, startAt: "2026-11-03", minutes: 30 },
    { id: "unrelated", clubId: "other", startAt: "2026-11-04", minutes: 120 },
  ];
  const total = (scope: string[], personal: boolean) => uniqueTrainingRows(rows.filter(row => statisticsRowInScope(row.clubId, scope, personal)))
    .reduce((sum, row) => sum + Number(row.minutes), 0);
  assert.equal(total(["sion"], false), 60);
  assert.equal(total(["valais"], false), 90);
  assert.equal(total(ids, false), 150);
  assert.equal(total(ids, true), 180);
});
