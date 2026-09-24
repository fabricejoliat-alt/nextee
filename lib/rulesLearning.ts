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

export type RulesSeasonAttemptScore = {
  seriesId: string;
  playerId: string;
  clubId: string;
  score: number;
  possible: number;
  submittedAt: string;
};

export type RulesSeasonPlayerScore = {
  playerId: string;
  clubId: string;
  completedSeries: number;
  rawPoints: number;
  possiblePoints: number;
  percentage: number;
  eligible: boolean;
  rank: number | null;
  lastSubmittedAt: string;
};

export function rulesSeasonPlayerLeaderboard(rows: RulesSeasonAttemptScore[], minimumSeries = 4): RulesSeasonPlayerScore[] {
  const grouped = new Map<string, RulesSeasonAttemptScore[]>();
  for (const row of rows) {
    const key = `${row.clubId}:${row.playerId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const aggregated = [...grouped.values()].map((entries) => {
    const uniqueBySeries = new Map(entries.map((entry) => [entry.seriesId, entry]));
    const attempts = [...uniqueBySeries.values()];
    const rawPoints = attempts.reduce((sum, entry) => sum + Math.max(0, Number(entry.score) || 0), 0);
    const possiblePoints = attempts.reduce((sum, entry) => sum + Math.max(0, Number(entry.possible) || 0), 0);
    const completedSeries = attempts.length;
    return {
      playerId: attempts[0]?.playerId ?? "",
      clubId: attempts[0]?.clubId ?? "",
      completedSeries,
      rawPoints,
      possiblePoints,
      percentage: possiblePoints > 0 ? Math.min(100, (rawPoints / possiblePoints) * 100) : 0,
      eligible: completedSeries >= minimumSeries,
      rank: null,
      lastSubmittedAt: attempts.reduce((latest, entry) => entry.submittedAt > latest ? entry.submittedAt : latest, ""),
    } satisfies RulesSeasonPlayerScore;
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible)
    || b.percentage - a.percentage
    || b.completedSeries - a.completedSeries
    || b.rawPoints - a.rawPoints
    || a.lastSubmittedAt.localeCompare(b.lastSubmittedAt)
    || a.playerId.localeCompare(b.playerId));
  const rankByClub = new Map<string, number>();
  return aggregated.map((row) => {
    if (!row.eligible) return row;
    const rank = (rankByClub.get(row.clubId) ?? 0) + 1;
    rankByClub.set(row.clubId, rank);
    return { ...row, rank };
  });
}

export function rulesSeasonClubLeaderboard(
  players: RulesSeasonPlayerScore[],
  minimumParticipants: number | ((clubId: string) => number) = 5,
) {
  const grouped = new Map<string, RulesSeasonPlayerScore[]>();
  for (const player of players) grouped.set(player.clubId, [...(grouped.get(player.clubId) ?? []), player]);
  const rows = [...grouped.entries()].map(([clubId, entries]) => {
    const eligiblePlayers = entries.filter((entry) => entry.eligible);
    const minimum = typeof minimumParticipants === "function" ? minimumParticipants(clubId) : minimumParticipants;
    return {
      clubId,
      participants: entries.length,
      eligiblePlayers: eligiblePlayers.length,
      eligible: eligiblePlayers.length >= minimum,
      minimum,
      score: eligiblePlayers.length ? eligiblePlayers.reduce((sum, entry) => sum + entry.percentage, 0) / eligiblePlayers.length : 0,
      completedSeries: eligiblePlayers.reduce((sum, entry) => sum + entry.completedSeries, 0),
      rawPoints: eligiblePlayers.reduce((sum, entry) => sum + entry.rawPoints, 0),
    };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible)
    || b.score - a.score
    || b.eligiblePlayers - a.eligiblePlayers
    || b.completedSeries - a.completedSeries
    || b.rawPoints - a.rawPoints
    || a.clubId.localeCompare(b.clubId));
  let rank = 0;
  return rows.map((row) => ({ ...row, rank: row.eligible ? ++rank : null }));
}

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
