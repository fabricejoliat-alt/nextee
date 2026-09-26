export type PlayerVisibleCoachFeedback = {
  event_id: string;
  player_id: string;
  coach_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  visible_to_player: boolean;
  player_note: string | null;
};

export function coachFeedbackWithLegacyPublicNote(
  feedback: PlayerVisibleCoachFeedback[],
  individualComments: unknown,
  playerId: string
) {
  if (!individualComments || typeof individualComments !== "object" || Array.isArray(individualComments)) {
    return feedback;
  }

  const legacyNote = String((individualComments as Record<string, unknown>)[playerId] ?? "").trim();
  if (!legacyNote || feedback.some((row) => String(row.player_note ?? "").trim())) return feedback;

  let noteAttached = false;
  return feedback.map((row) => {
    if (noteAttached || String(row.player_note ?? "").trim()) return row;
    noteAttached = true;
    return { ...row, player_note: legacyNote };
  });
}
