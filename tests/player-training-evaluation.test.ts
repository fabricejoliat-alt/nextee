import assert from "node:assert/strict";
import test from "node:test";
import { playerTrainingEvaluationState } from "../lib/playerTrainingEvaluation.ts";
import { summarizePlayerHome } from "../lib/playerHomeSummary.ts";

const past = { performanceEnabled: true, isPast: true, completed: false };

test("incomplete personal training, private lessons and camps require evaluation like the drawer", () => {
  for (const session_type of ["club", "private", "individual"] as const) {
    const session = { id: session_type, session_type, club_event_id: null, start_at: "2026-10-22T11:30:00Z",
      total_minutes: 60, motivation: null, difficulty: null, satisfaction: null };
    const summary = summarizePlayerHome({ sessions: [session], items: [], events: [], attendees: [],
      performanceEnabled: true, now: "2026-10-24T10:00:00Z", monthStart: "2026-10-01", monthEnd: "2026-11-01", previousMonthStart: "2026-09-01" });
    assert.equal(summary.pendingTrainings.length, 1);
    assert.deepEqual(playerTrainingEvaluationState(past), { needsEvaluation: true, optionalEvaluation: false, completed: false });
  }
  assert.equal(playerTrainingEvaluationState({ ...past, eventType: "camp", requiresEvaluation: true }).needsEvaluation, true);
});

test("calendar preserves explicit optional evaluations and excludes absent, completed, future and basic-mode activities", () => {
  assert.deepEqual(playerTrainingEvaluationState({ ...past, eventType: "training", requiresEvaluation: false }), {
    needsEvaluation: false, optionalEvaluation: true, completed: true,
  });
  for (const override of [{ completed: true }, { isPast: false }, { performanceEnabled: false },
    { eventType: "event" }, { attendance: "absent" }, { attendance: "excused" }, { attendance: "not_registered" }]) {
    const result = playerTrainingEvaluationState({ ...past, ...override });
    assert.equal(result.needsEvaluation, false);
    assert.equal(result.optionalEvaluation, false);
  }
  assert.equal(playerTrainingEvaluationState({ ...past, attendance: "present", eventType: "training", requiresEvaluation: true }).needsEvaluation, true);
});
