import type { ValidationExerciseItem } from "./validations";

export type CoachValidationPlayer = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
export type CoachValidationExerciseSource = Omit<ValidationExerciseItem, "is_validated" | "is_unlocked" | "attempts">;
export type CoachValidationExercise = CoachValidationExerciseSource & {
  validated_player_count: number;
  player_count: number;
  challengers: CoachValidationPlayer[];
};
export type CoachValidationSectionSource = { id: string; slug: string; name: string; sort_order: number; is_active: boolean };
export type CoachValidationSection = CoachValidationSectionSource & { exercises: CoachValidationExercise[] };

/** Counts unique player/exercise successes, never failed attempts or group medals. */
export function buildCoachValidations(
  sections: CoachValidationSectionSource[], exercises: CoachValidationExerciseSource[], playerIds: string[],
  profiles: CoachValidationPlayer[], attempts: Array<{ player_id: string; exercise_id: string; result: string }>
): CoachValidationSection[] {
  const players = [...new Set(playerIds)];
  const allowed = new Set(players);
  const profileById = new Map(profiles.map((player) => [player.id, player]));
  const successes = new Map<string, Set<string>>();
  for (const attempt of attempts) {
    if (attempt.result !== "success" || !allowed.has(attempt.player_id)) continue;
    const set = successes.get(attempt.player_id) ?? new Set<string>();
    set.add(attempt.exercise_id);
    successes.set(attempt.player_id, set);
  }
  return sections.filter((section) => section.is_active).map((section) => {
    const ordered = exercises.filter((exercise) => exercise.is_active && exercise.section_id === section.id)
      .sort((a, b) => a.sequence_no - b.sequence_no || a.id.localeCompare(b.id));
    return { ...section, exercises: ordered.map((exercise, index) => {
      const validatedPlayers = players.filter((playerId) => successes.get(playerId)?.has(exercise.id));
      const challengers = players.filter((playerId) => {
        const validated = successes.get(playerId) ?? new Set<string>();
        return !validated.has(exercise.id) && ordered.slice(0, index).every((previous) => validated.has(previous.id));
      }).map((playerId) => profileById.get(playerId) ?? { id: playerId, first_name: null, last_name: null, avatar_url: null });
      return { ...exercise, validated_player_count: validatedPlayers.length, player_count: players.length, challengers };
    }) };
  });
}
