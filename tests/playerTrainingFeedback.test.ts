import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  coachFeedbackWithLegacyPublicNote,
  type PlayerVisibleCoachFeedback,
} from "../lib/playerTrainingFeedback.ts";

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";

function feedback(playerNote: string | null): PlayerVisibleCoachFeedback[] {
  return [{
    event_id: "22222222-2222-4222-8222-222222222222",
    player_id: PLAYER_ID,
    coach_id: "33333333-3333-4333-8333-333333333333",
    engagement: 5,
    attitude: 4,
    performance: 6,
    visible_to_player: true,
    player_note: playerNote,
  }];
}

test("restores a legacy public note for an existing visible coach evaluation", () => {
  const result = coachFeedbackWithLegacyPublicNote(
    feedback(null),
    { [PLAYER_ID]: "  Continuer le travail d’alignement.  " },
    PLAYER_ID
  );

  assert.equal(result[0]?.player_note, "Continuer le travail d’alignement.");
});

test("keeps the current public note when it is already populated", () => {
  const result = coachFeedbackWithLegacyPublicNote(
    feedback("Note actuelle"),
    { [PLAYER_ID]: "Ancienne note" },
    PLAYER_ID
  );

  assert.equal(result[0]?.player_note, "Note actuelle");
});

test("never creates coach feedback from a legacy comment alone", () => {
  const result = coachFeedbackWithLegacyPublicNote([], { [PLAYER_ID]: "Ancienne note" }, PLAYER_ID);
  assert.deepEqual(result, []);
});

test("groups the linked training page into responsive participant, structure and evaluation sections", () => {
  const page = readFileSync(
    new URL("../app/player/golf/trainings/new/PlayerTrainingNewClient.tsx", import.meta.url),
    "utf8"
  );
  const css = readFileSync(
    new URL("../app/player/golf/trainings/new/PlayerTrainingNew.module.css", import.meta.url),
    "utf8"
  );

  assert.match(page, /"Participants"/);
  assert.match(page, /"La structure"/);
  assert.match(page, /"Les évaluations"/);
  assert.match(page, /className=\{styles\.evaluationFooter\}/);
  assert.match(page, /className=\{styles\.coachEvaluationHeader\}/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.evaluationFooter/);
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});
