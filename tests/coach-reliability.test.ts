import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { coachCampRegistrationChanges } from "../lib/coachCampRegistrations.ts";
import { coachCalendarActionState, coachPlayerEvaluationComplete, coachTrainingCompletionByEvent,
  type CoachEvaluationCriterionState } from "../lib/coachCalendar.ts";

const criterion: CoachEvaluationCriterionState = { id: "criterion", event_id: "event", is_enabled: true,
  snapshot_respondent: "coach", snapshot_is_required: true, snapshot_response_format: "yes_no",
  snapshot_choices: [{ value: true }, { value: false }] };

test("required custom criteria use strict typed values and accept false/zero", () => {
  assert.equal(coachPlayerEvaluationComplete("present", [4,4,4], [criterion], {}), false);
  assert.equal(coachPlayerEvaluationComplete("present", [4,4,4], [criterion], { criterion: false }), true);
  assert.equal(coachPlayerEvaluationComplete("present", [4,4,4], [criterion], { criterion: "false" }), false);
  assert.equal(coachPlayerEvaluationComplete("present", [4,4,4], [{ ...criterion, snapshot_choices: [{ value: 0 }] }], { criterion: 0 }), true);
  assert.equal(coachPlayerEvaluationComplete("present", [4.5,4,4]), false);
});
test("absences, player-only and optional criteria never block Coach completion", () => {
  assert.equal(coachPlayerEvaluationComplete("absent", [null,null,null], [criterion]), true);
  assert.equal(coachPlayerEvaluationComplete(null, [4,4,4]), false);
  for (const change of [{ snapshot_is_required: false }, { is_enabled: false }, { snapshot_respondent: "player" }]) {
    assert.equal(coachPlayerEvaluationComplete("present", [4,4,4], [{ ...criterion, ...change }]), true);
  }
});
test("required short text rejects blanks and oversized values", () => {
  const text = { ...criterion, snapshot_response_format: "short_text" };
  for (const value of [null, 3, " ", "a".repeat(241)]) assert.equal(coachPlayerEvaluationComplete("present", [4,4,4], [text], { criterion: value }), false);
  assert.equal(coachPlayerEvaluationComplete("present", [4,4,4], [text], { criterion: "OK" }), true);
});
test("home/calendar completion cannot borrow another event or player's answer", () => {
  const attendees = [{ event_id: "event", player_id: "player", coach_recorded_status: "present" as const }];
  const feedback = [{ event_id: "event", player_id: "player", engagement: 4, attitude: 4, performance: 4 }];
  const response = { event_id: "event", player_id: "player", event_criterion_id: "criterion", respondent_role: "coach", value_json: true };
  for (const change of [{ event_id: "other" }, { player_id: "other" }, { respondent_role: "player" }]) {
    assert.equal(coachTrainingCompletionByEvent(["event"], attendees, feedback, [criterion], [{ ...response, ...change }]).event, false);
  }
  assert.equal(coachTrainingCompletionByEvent(["event"], attendees, feedback, [criterion], [response]).event, true);
});
test("cancelled and non-evaluable trainings never request evaluation", () => {
  const event = { event_type: "training", starts_at: "2026-01-01T10:00:00Z", ends_at: null, duration_minutes: 60 };
  for (const change of [{ status: "cancelled" }, { requires_evaluation: false }]) {
    assert.equal(coachCalendarActionState({ ...event, ...change }, false, Date.parse("2026-01-02")), "view_activity");
  }
});
test("camp PATCH omits untouched players, daily attendance and registration status", () => {
  const before = [{ player_id: "one", registration_status: "registered", day_status_by_day_index: { "0": "absent", "1": "present" } }];
  const draft = { one: { registration_status: "registered", day_status_by_day_index: { "0": "absent", "1": "present" } } };
  assert.deepEqual(coachCampRegistrationChanges(before, draft), []);
  draft.one.day_status_by_day_index["1"] = "absent";
  assert.deepEqual(coachCampRegistrationChanges(before, draft), [{ player_id: "one", day_status_by_day_index: { "1": "absent" } }]);
  draft.one.registration_status = "declined";
  assert.deepEqual(coachCampRegistrationChanges(before, draft), [{ player_id: "one", registration_status: "declined" }]);
});
test("guided UI and transactional save include custom criteria and concurrency tokens", () => {
  const page = readFileSync(new URL("../app/coach/groups/[id]/planning/[eventId]/debrief/page.tsx", import.meta.url), "utf8");
  assert.match(page, /EvaluationResponseField/);
  assert.match(page, /expected_recorded_at: currentReview.recordedAt/);
  assert.match(page, /remainingIndex === -1/);
  const seriesPage = readFileSync(new URL("../app/coach/groups/[id]/planning/[eventId]/edit/page.tsx", import.meta.url), "utf8");
  const saveSeries = seriesPage.slice(seriesPage.indexOf("async function saveSeries"), seriesPage.indexOf("async function removeThisEvent"));
  assert.match(saveSeries, /update_coach_event_series_v1/);
  assert.doesNotMatch(saveSeries, /\.delete\(|\.insert\(|syncPlayerChanges/);
});
