import { calculateGolfRoundMetrics, type GolfHoleInput } from "./golfRoundMetrics.ts";

export type MatchPlayRound = {
  om_competition_format?: string | null;
  om_match_result?: "won" | "lost" | null;
  match_score_text?: string | null;
};

export function isMatchPlayRound(round: MatchPlayRound) {
  return round.om_competition_format === "match_play_individual";
}

/** Match play is completed by its result, independently of a stroke scorecard. */
export function golfRoundPresentation(round: MatchPlayRound, holes: GolfHoleInput[]) {
  const metrics = calculateGolfRoundMetrics(holes);
  const isMatchPlay = isMatchPlayRound(round);
  return {
    metrics,
    isMatchPlay,
    complete: isMatchPlay ? round.om_match_result === "won" || round.om_match_result === "lost" : metrics.complete,
  };
}
