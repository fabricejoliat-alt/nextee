import assert from "node:assert/strict";
import test from "node:test";
import { canChangePastTrainingAttendance, type PastTrainingAttendanceState } from "../lib/playerTrainingAttendanceChange.ts";

const now = new Date("2026-10-13T12:00:00Z");
const eligible: PastTrainingAttendanceState = {
  eventType: "training", eventStatus: "scheduled",
  eventStartsAt: "2026-10-12T09:00:00Z", eventEndsAt: "2026-10-12T10:00:00Z", eventDurationMinutes: 60,
  coachRecordedStatus: null, coachFeedbackRecorded: false, coachResponseRecorded: false,
  playerRatings: [null, null, null], playerResponseRecorded: false,
};

test("past unevaluated club training allows an attendance change", () => {
  assert.equal(canChangePastTrainingAttendance(eligible, now), true);
  assert.equal(canChangePastTrainingAttendance({ ...eligible, eventEndsAt: null }, now), true);
});

test("coach or junior evaluation locks attendance", () => {
  assert.equal(canChangePastTrainingAttendance({ ...eligible, coachRecordedStatus: "absent" }, now), false);
  assert.equal(canChangePastTrainingAttendance({ ...eligible, coachFeedbackRecorded: true }, now), false);
  assert.equal(canChangePastTrainingAttendance({ ...eligible, coachResponseRecorded: true }, now), false);
  assert.equal(canChangePastTrainingAttendance({ ...eligible, playerRatings: [3, null, null] }, now), false);
  assert.equal(canChangePastTrainingAttendance({ ...eligible, playerResponseRecorded: true }, now), false);
});

test("future, cancelled and non-training events cannot change through this control", () => {
  assert.equal(canChangePastTrainingAttendance({ ...eligible, eventEndsAt: "2026-10-14T10:00:00Z" }, now), false);
  assert.equal(canChangePastTrainingAttendance({ ...eligible, eventStatus: "cancelled" }, now), false);
  assert.equal(canChangePastTrainingAttendance({ ...eligible, eventType: "competition" }, now), false);
});
