import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CoachDebriefValidationError,
  hasAnalyzableDebriefSource,
  needsCoachPlayerEvaluation,
  normalizeCoachDebriefAnalysis,
  normalizeDebriefSaveInput,
  normalizeCoachPlayerEvaluationInput,
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
  assert.equal(result.report_scope, "collective");
  assert.equal(result.collective_summary_text, null);
  assert.deepEqual(result.individual_comments, {});
  assert.deepEqual(result.reviews[1], {
    player_id: PLAYER_B,
    status: "absent",
    engagement: null,
    attitude: null,
    performance: null,
  });
});

test("keeps separate player sources and accepts only the two current modes", () => {
  const result = normalizeDebriefSaveInput(
    {
      report_scope: "individual",
      collective_summary_text: "Résumé collectif conservé",
      individual_comments: {
        [PLAYER_A]: "  Bon contrôle de distance.  ",
        [PLAYER_B]: "",
      },
      reviews: [
        { player_id: PLAYER_A, status: "present", engagement: 5, attitude: 4, performance: 6 },
        { player_id: PLAYER_B, status: "absent" },
      ],
    },
    [PLAYER_A, PLAYER_B]
  );

  assert.equal(result.report_scope, "individual");
  assert.equal(result.collective_summary_text, "Résumé collectif conservé");
  assert.deepEqual(result.individual_comments, { [PLAYER_A]: "Bon contrôle de distance." });
  assert.equal(hasAnalyzableDebriefSource("individual", null, result.individual_comments, [PLAYER_A]), true);
  assert.equal(hasAnalyzableDebriefSource("individual", null, result.individual_comments, [PLAYER_B]), false);
});

test("rejects individual comments for players outside the session", () => {
  assert.throws(
    () =>
      normalizeDebriefSaveInput(
        {
          report_scope: "individual",
          individual_comments: { [PLAYER_B]: "Observation" },
          reviews: [{ player_id: PLAYER_A, status: "absent" }],
        },
        [PLAYER_A]
      ),
    (error) => error instanceof CoachDebriefValidationError && error.code === "invalid_player"
  );
});

test("normalizes distinct collective and individual AI results without inventing assignments", () => {
  const raw = {
    collective_summary: "  Séance structurée autour de l’alignement.  ",
    proposals: [
      { player_id: PLAYER_A, text: "  Alignement à poursuivre. ", rationale: "Nom explicite", confidence: "high" },
      { player_id: PLAYER_B, text: "Ne doit pas passer", rationale: "Hors présence", confidence: "high" },
    ],
  };

  const collective = normalizeCoachDebriefAnalysis(raw, "collective", [PLAYER_A]);
  assert.equal(collective.collectiveSummary, "Séance structurée autour de l’alignement.");
  assert.deepEqual(collective.proposals, [
    { player_id: PLAYER_A, text: "Alignement à poursuivre.", rationale: "Nom explicite", confidence: "high" },
  ]);

  const individual = normalizeCoachDebriefAnalysis(raw, "individual", [PLAYER_A]);
  assert.equal(individual.collectiveSummary, "");
  assert.equal(individual.proposals[0]?.player_id, PLAYER_A);
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

test("normalizes one guided player evaluation without leaking absent-player fields", () => {
  const present = normalizeCoachPlayerEvaluationInput({
    player_id: PLAYER_A,
    status: "present",
    engagement: 5,
    attitude: 4,
    performance: 6,
    player_note: "  Travail d’alignement.  ",
    private_note: "  Continuer ce travail.  ",
  });
  assert.equal(present.player_note, "Travail d’alignement.");
  assert.equal(present.private_note, "Continuer ce travail.");

  const absent = normalizeCoachPlayerEvaluationInput({
    player_id: PLAYER_B,
    status: "absent",
    engagement: 6,
    attitude: 6,
    performance: 6,
    player_note: "Ne doit pas être enregistré",
    private_note: "Ne doit pas devenir une note",
  });
  assert.deepEqual(absent, {
    player_id: PLAYER_B,
    status: "absent",
    engagement: null,
    attitude: null,
    performance: null,
    player_note: "",
    private_note: null,
  });
});

test("requires ratings but allows an independent private guided note", () => {
  assert.throws(
    () => normalizeCoachPlayerEvaluationInput({
      player_id: PLAYER_A,
      status: "present",
      engagement: 5,
      attitude: null,
      performance: 6,
    }),
    (error) => error instanceof CoachDebriefValidationError && error.code === "ratings_required"
  );
  const privateOnly = normalizeCoachPlayerEvaluationInput({
    player_id: PLAYER_A,
    status: "present",
    engagement: 5,
    attitude: 5,
    performance: 6,
    private_note: "Note interne",
  });
  assert.equal(privateOnly.player_note, "");
  assert.equal(privateOnly.private_note, "Note interne");
});

test("resume logic never skips an existing absence", () => {
  assert.equal(needsCoachPlayerEvaluation(null, [null, null, null]), true);
  assert.equal(needsCoachPlayerEvaluation("absent", [null, null, null]), true);
  assert.equal(needsCoachPlayerEvaluation("present", [5, 4, 6]), false);
  assert.equal(needsCoachPlayerEvaluation("present", [5, null, 6]), true);
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

test("the guided UI and API save exactly one player without exposing collective controls", () => {
  const page = readFileSync(
    new URL("../app/coach/groups/[id]/planning/[eventId]/debrief/page.tsx", import.meta.url),
    "utf8"
  );
  const playerAnalyzeRoute = readFileSync(
    new URL("../app/api/coach/events/[eventId]/debrief/analyze-player/route.ts", import.meta.url),
    "utf8"
  );
  const playerSaveRoute = readFileSync(
    new URL("../app/api/coach/events/[eventId]/debrief/player/route.ts", import.meta.url),
    "utf8"
  );
  const eventDetailRoute = readFileSync(
    new URL("../app/api/coach/events/[eventId]/route.ts", import.meta.url),
    "utf8"
  );
  const eventDetailPage = readFileSync(
    new URL("../app/coach/groups/[id]/planning/[eventId]/page.tsx", import.meta.url),
    "utf8"
  );
  const migration = readFileSync(
    new URL("../supabase/migrations/20260926_save_coach_training_player_evaluation.sql", import.meta.url),
    "utf8"
  );
  const reportDependencyFix = readFileSync(
    new URL("../supabase/migrations/20260926_fix_guided_player_evaluation_report_dependency.sql", import.meta.url),
    "utf8"
  );

  assert.match(page, /currentIndex/);
  assert.match(page, /saveAndNext/);
  assert.match(page, /saveAndFinish/);
  assert.match(page, /saveInFlightRef/);
  assert.match(page, /needsCoachPlayerEvaluation/);
  assert.match(page, /debrief\/analyze-player/);
  assert.match(page, /debrief\/player/);
  assert.match(page, /audience: "junior"/);
  assert.match(page, /audience: "private"/);
  assert.match(page, /audience: "junior", locale/);
  assert.match(page, /audience: "private", locale/);
  assert.doesNotMatch(page, /coachDebrief\.aiDisclosure/);
  assert.doesNotMatch(page, /scopeChoice|collectiveSummary|analyzeReport/);
  assert.match(playerAnalyzeRoute, /enum: \[playerId\]/);
  assert.match(playerAnalyzeRoute, /individual_source: sourceText/);
  assert.match(playerAnalyzeRoute, /body\?\.audience === "private"/);
  assert.match(playerAnalyzeRoute, /responseLanguage\(body\?\.locale\)/);
  assert.match(playerAnalyzeRoute, /write both the text and rationale only in \$\{outputLanguage\}/);
  assert.doesNotMatch(playerAnalyzeRoute, /collective_source|individual_sources|save_coach_training_debrief/);
  assert.match(playerSaveRoute, /save_coach_training_player_evaluation_v1/);
  assert.match(playerSaveRoute, /p_player_id: normalized\.player_id/);
  assert.doesNotMatch(playerSaveRoute, /Training assistance is disabled for this coach/);
  assert.match(eventDetailRoute, /player_id,status,coach_recorded_status,coach_recorded_by,coach_recorded_at/);
  assert.match(eventDetailPage, /const attendanceStatus = attendee\.coach_recorded_status/);
  assert.match(page, /player_note: playerNote/);
  assert.match(page, /privateNoteHelp/);
  assert.match(page, /feedbackNoteBlock/);
  assert.match(migration, /update public\.club_event_attendees/);
  assert.match(migration, /insert into public\.club_event_coach_feedback/);
  assert.match(migration, /nullif\(v_private_note, ''\), nullif\(v_source_text, ''\)/);
  assert.match(reportDependencyFix, /nullif\(v_private_note, ''\), nullif\(v_source_text, ''\)/);
  assert.doesNotMatch(reportDependencyFix, /report_required|validate_coach_training_private_notes/);
  assert.doesNotMatch(migration, /set report_text\s*=/);
});
