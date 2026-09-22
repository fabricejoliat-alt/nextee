export type RulesPhase = "upcoming" | "learning" | "quiz_soon" | "quiz_open" | "quiz_closed" | "results" | "archived";

export type ScoreConfig = {
  pointsPerCorrect: number;
  speedBonusEnabled: boolean;
  maxSpeedBonus: number;
  freeReadingSeconds: number;
  decaySeconds: number;
  perfectBonus: number;
};

export function rulesPhase(now: Date, dates: {
  discoveryStartsAt: Date; quizOpensAt: Date; quizClosesAt: Date;
  resultsPublishedAt: Date | null; archivedAt?: Date | null;
}): RulesPhase {
  const time = now.getTime();
  if (dates.archivedAt && time >= dates.archivedAt.getTime()) return "archived";
  if (dates.resultsPublishedAt && time >= dates.resultsPublishedAt.getTime()) return "results";
  if (time >= dates.quizClosesAt.getTime()) return "quiz_closed";
  if (time >= dates.quizOpensAt.getTime()) return "quiz_open";
  if (time >= dates.quizOpensAt.getTime() - 48 * 60 * 60 * 1000) return "quiz_soon";
  if (time >= dates.discoveryStartsAt.getTime()) return "learning";
  return "upcoming";
}

export function speedBonus(answeredAtMs: number, shownAtMs: number, config: ScoreConfig) {
  if (!config.speedBonusEnabled) return 0;
  const elapsed = Math.max(0, (answeredAtMs - shownAtMs) / 1000);
  if (elapsed <= config.freeReadingSeconds) return config.maxSpeedBonus;
  if (config.decaySeconds <= 0) return 0;
  const ratio = Math.max(0, 1 - (elapsed - config.freeReadingSeconds) / config.decaySeconds);
  return Math.round(config.maxSpeedBonus * ratio);
}

export function calculateRulesScore(
  answers: Array<{ correct: boolean; shownAtMs: number; answeredAtMs: number }>,
  config: ScoreConfig,
) {
  const correctCount = answers.filter((answer) => answer.correct).length;
  const base = correctCount * config.pointsPerCorrect;
  const speed = answers.reduce((sum, answer) => sum + (answer.correct
    ? speedBonus(answer.answeredAtMs, answer.shownAtMs, config)
    : 0), 0);
  const perfect = answers.length > 0 && correctCount === answers.length ? config.perfectBonus : 0;
  return { correctCount, base, speed, perfect, total: base + speed + perfect };
}

export type ClubScore = { clubId: string; score: number; correct: number; perfect: boolean; speed: number; submittedAt: string };

export type EditorialQuestion = {
  kind: "practice" | "official";
  editorial_status: string;
  prompt: string;
  explanation: string;
  image_alt: string;
  allows_multiple: boolean;
  rules_question_options: Array<{ label: string; explanation: string; is_correct: boolean }>;
};

export function rulesQuestionReadiness(questions: EditorialQuestion[]) {
  const approved = questions.filter((question) => question.editorial_status === "approved");
  const practice = approved.filter((question) => question.kind === "practice").length;
  const official = approved.filter((question) => question.kind === "official").length;
  const questionsValid = approved.every((question) => {
    const options = question.rules_question_options;
    const correct = options.filter((option) => option.is_correct).length;
    return Boolean(question.prompt.trim() && question.explanation.trim() && question.image_alt.trim())
      && options.length >= 3 && options.length <= 4
      && (question.allows_multiple ? correct >= 1 : correct === 1)
      && options.every((option) => option.label.trim() && option.explanation.trim());
  });
  return { practice, official, valid: practice >= 1 && official >= 2 && questionsValid };
}

export function clubLeaderboard(rows: ClubScore[], retained: 10 | 15, minimumParticipants: number) {
  const grouped = new Map<string, ClubScore[]>();
  rows.forEach((row) => grouped.set(row.clubId, [...(grouped.get(row.clubId) ?? []), row]));
  return [...grouped.entries()].map(([clubId, entries]) => {
    const sorted = entries.slice().sort((a, b) => b.score - a.score || b.correct - a.correct || Number(b.perfect) - Number(a.perfect) || b.speed - a.speed || a.submittedAt.localeCompare(b.submittedAt));
    const selected = sorted.slice(0, retained);
    return {
      clubId, participants: entries.length, eligible: entries.length >= minimumParticipants,
      score: selected.length ? selected.reduce((sum, row) => sum + row.score, 0) / selected.length : 0,
      correct: selected.reduce((sum, row) => sum + row.correct, 0),
      perfect: selected.filter((row) => row.perfect).length,
      speed: selected.reduce((sum, row) => sum + row.speed, 0),
    };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || b.correct - a.correct || b.perfect - a.perfect || b.speed - a.speed || a.clubId.localeCompare(b.clubId));
}
