import assert from "node:assert/strict";
import test from "node:test";
import {
  CoachDebriefValidationError,
  normalizeDebriefSaveInput,
  normalizePrivateNoteProposals,
} from "../lib/coachDebrief.ts";
import { assertCoachTrainingReportAllowed } from "../lib/coachTrainingAssistance.ts";

const PLAYER_A = "11111111-1111-4111-8111-111111111111";
const PLAYER_B = "22222222-2222-4222-8222-222222222222";

test("normalizes present ratings and clears absent ratings", () => {
  const result = normalizeDebriefSaveInput(
    {
      report_text: "  Travail collectif puis observation individuelle.  ",
      report_scope: "mixed",
      reviews: [
        { player_id: PLAYER_A, status: "present", engagement: 5, attitude: 4, performance: 6 },
        { player_id: PLAYER_B, status: "absent", engagement: 6, attitude: 6, performance: 6 },
      ],
    },
    [PLAYER_A, PLAYER_B]
  );

  assert.equal(result.report_text, "Travail collectif puis observation individuelle.");
  assert.deepEqual(result.reviews[1], {
    player_id: PLAYER_B,
    status: "absent",
    engagement: null,
    attitude: null,
    performance: null,
  });
});

test("rejects a present player without all ActiviTee ratings", () => {
  assert.throws(
    () =>
      normalizeDebriefSaveInput(
        {
          reviews: [{ player_id: PLAYER_A, status: "present", engagement: 5, attitude: null, performance: 6 }],
        },
        [PLAYER_A]
      ),
    (error) => error instanceof CoachDebriefValidationError && error.code === "ratings_required"
  );
});

test("rejects a note for an absent player", () => {
  assert.throws(
    () => normalizePrivateNoteProposals({ proposals: [{ player_id: PLAYER_B, text: "Observation" }] }, [PLAYER_A]),
    (error) => error instanceof CoachDebriefValidationError && error.code === "player_not_present"
  );
});

test("keeps attendance-only saves available when training assistance is disabled", () => {
  assert.doesNotThrow(() => assertCoachTrainingReportAllowed(false, null));
  assert.doesNotThrow(() => assertCoachTrainingReportAllowed(false, "   "));
});

test("rejects a session report when organization training assistance is disabled", () => {
  assert.throws(
    () => assertCoachTrainingReportAllowed(false, "Compte-rendu collectif"),
    (error) =>
      error instanceof CoachDebriefValidationError && error.code === "coach_training_assistance_disabled"
  );
});
