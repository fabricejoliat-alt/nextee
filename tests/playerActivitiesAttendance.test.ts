import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../app/player/golf/trainings/page.tsx", import.meta.url),
  "utf8"
);

test("future absent activities keep an interactive attendance toggle", () => {
  assert.match(page, /const showAttendance=a\.isFuture&&a\.event&&!a\.isCompetition;/);
  assert.match(page, /<AttendanceToggle variant="pill" checked=\{!isAbsent\}/);
  assert.doesNotMatch(page, /staticAttendance|pointer-events:none/);
});
