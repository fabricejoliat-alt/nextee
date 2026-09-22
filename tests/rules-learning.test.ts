import assert from "node:assert/strict";
import test from "node:test";
import { calculateRulesScore, clubLeaderboard, rulesPhase, rulesQuestionReadiness, speedBonus } from "../lib/rulesLearning.ts";

const config = { pointsPerCorrect: 100, speedBonusEnabled: true, maxSpeedBonus: 15, freeReadingSeconds: 5, decaySeconds: 15, perfectBonus: 50 };

test("le bonus de rapidité décroît après le délai gratuit", () => {
  assert.equal(speedBonus(4_000, 0, config), 15);
  assert.equal(speedBonus(12_500, 0, config), 8);
  assert.equal(speedBonus(25_000, 0, config), 0);
  assert.equal(speedBonus(4_000, 0, { ...config, speedBonusEnabled: false }), 0);
});

test("le score ne récompense la rapidité que sur une bonne réponse et ajoute le sans-faute", () => {
  assert.deepEqual(calculateRulesScore([
    { correct: true, shownAtMs: 0, answeredAtMs: 4_000 },
    { correct: false, shownAtMs: 0, answeredAtMs: 2_000 },
  ], config), { correctCount: 1, base: 100, speed: 15, perfect: 0, total: 115 });
  assert.equal(calculateRulesScore([{ correct: true, shownAtMs: 0, answeredAtMs: 4_000 }], config).total, 165);
});

test("les phases reposent sur les dates explicites", () => {
  const dates = { discoveryStartsAt: new Date("2026-01-01Z"), quizOpensAt: new Date("2026-01-22Z"), quizClosesAt: new Date("2026-01-29Z"), resultsPublishedAt: new Date("2026-01-29Z") };
  assert.equal(rulesPhase(new Date("2025-12-31Z"), dates), "upcoming");
  assert.equal(rulesPhase(new Date("2026-01-10Z"), dates), "learning");
  assert.equal(rulesPhase(new Date("2026-01-21Z"), dates), "quiz_soon");
  assert.equal(rulesPhase(new Date("2026-01-23Z"), dates), "quiz_open");
  assert.equal(rulesPhase(new Date("2026-01-30Z"), dates), "results");
});

test("le classement retient 10 ou 15 scores et applique le minimum", () => {
  const rows = Array.from({ length: 16 }, (_, index) => ({ clubId: "a", score: 1000 - index, correct: 6, perfect: index < 2, speed: 50, submittedAt: `2026-01-${String(index + 1).padStart(2, "0")}T10:00:00Z` }));
  const ten = clubLeaderboard([...rows, { ...rows[0], clubId: "b" }], 10, 2);
  assert.equal(ten[0].participants, 16);
  assert.equal(ten[0].score, 995.5);
  assert.equal(ten[1].eligible, false);
  assert.equal(clubLeaderboard(rows, 15, 1)[0].score, 993);
});

test("la publication exige un entraînement et deux variantes officielles valides", () => {
  const option = (correct: boolean) => ({ label: "Réponse", explanation: "Explication", is_correct: correct });
  const question = (kind: "practice" | "official") => ({
    kind, editorial_status: "approved", prompt: "Situation ?", explanation: "Explication.",
    image_alt: "Description accessible.", allows_multiple: false,
    rules_question_options: [option(true), option(false), option(false)],
  });
  assert.equal(rulesQuestionReadiness([question("practice"), question("official")]).valid, false);
  assert.equal(rulesQuestionReadiness([question("practice"), question("official"), question("official")]).valid, true);
  const invalid = question("official");
  invalid.rules_question_options[1].is_correct = true;
  assert.equal(rulesQuestionReadiness([question("practice"), question("official"), invalid]).valid, false);
});
