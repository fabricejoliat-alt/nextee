import assert from "node:assert/strict";
import test from "node:test";
import { calculateRulesScore, clubLeaderboard, rulesPhase, rulesQuestionReadiness, rulesSeasonClubLeaderboard, rulesSeasonPlayerLeaderboard, speedBonus } from "../lib/rulesLearning.ts";

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

test("le classement saisonnier exige quatre séries et départage par participation", () => {
  const attempts = [
    ...Array.from({ length: 4 }, (_, index) => ({ seriesId: `a-${index}`, playerId: "a", clubId: "club-a", score: 90, possible: 100, submittedAt: `2027-0${index + 1}-28` })),
    { seriesId: "b-1", playerId: "b", clubId: "club-a", score: 100, possible: 100, submittedAt: "2027-01-28" },
    ...Array.from({ length: 5 }, (_, index) => ({ seriesId: `c-${index}`, playerId: "c", clubId: "club-a", score: 450, possible: 500, submittedAt: `2027-0${index + 1}-28` })),
  ];
  const rows = rulesSeasonPlayerLeaderboard(attempts, 4);
  assert.equal(rows.find((row) => row.playerId === "c")?.rank, 1);
  assert.equal(rows.find((row) => row.playerId === "a")?.rank, 2);
  assert.equal(rows.find((row) => row.playerId === "b")?.rank, null);
  assert.equal(rows.find((row) => row.playerId === "b")?.eligible, false);
  assert.equal(rows.find((row) => row.playerId === "b")?.percentage, 100);
});

test("le classement club moyenne seulement les juniors éligibles", () => {
  const players = rulesSeasonPlayerLeaderboard([
    ...Array.from({ length: 4 }, (_, index) => ({ seriesId: `a-${index}`, playerId: "a", clubId: "club-a", score: 90, possible: 100, submittedAt: `2027-0${index + 1}-28` })),
    ...Array.from({ length: 4 }, (_, index) => ({ seriesId: `b-${index}`, playerId: "b", clubId: "club-a", score: 80, possible: 100, submittedAt: `2027-0${index + 1}-28` })),
    { seriesId: "c-1", playerId: "c", clubId: "club-a", score: 100, possible: 100, submittedAt: "2027-01-28" },
  ], 4);
  const clubs = rulesSeasonClubLeaderboard(players, 2);
  assert.equal(clubs[0].eligiblePlayers, 2);
  assert.equal(clubs[0].participants, 3);
  assert.equal(clubs[0].eligible, true);
  assert.equal(clubs[0].score, 85);
});

test("un joueur multi-clubs reçoit un rang propre dans chacun de ses clubs", () => {
  const attempts = ["club-a", "club-b"].flatMap((clubId) => Array.from({ length: 4 }, (_, index) => ({
    seriesId: `series-${index}`,
    playerId: "multi-club-player",
    clubId,
    score: 90,
    possible: 100,
    submittedAt: `2027-0${index + 1}-28`,
  })));
  const rows = rulesSeasonPlayerLeaderboard([
    ...attempts,
    ...Array.from({ length: 4 }, (_, index) => ({ seriesId: `series-${index}`, playerId: "leader-a", clubId: "club-a", score: 95, possible: 100, submittedAt: `2027-0${index + 1}-27` })),
  ], 4);
  assert.equal(rows.find((row) => row.playerId === "multi-club-player" && row.clubId === "club-a")?.rank, 2);
  assert.equal(rows.find((row) => row.playerId === "multi-club-player" && row.clubId === "club-b")?.rank, 1);
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
