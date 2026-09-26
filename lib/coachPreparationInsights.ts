export const COACH_PREPARATION_MAX_HISTORY_EVENTS = 5;
export const COACH_PREPARATION_MAX_POINTS = 4;
export const COACH_PREPARATION_POINT_MAX_LENGTH = 180;

export type CoachPreparationAttentionPoint = {
  text: string;
};

export type CoachPreparationInsight = {
  player_id: string;
  points: CoachPreparationAttentionPoint[];
  source_event_count: number;
  generated_at: string;
};

export function normalizeCoachPreparationPoints(raw: unknown): CoachPreparationAttentionPoint[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { points?: unknown }).points)
      ? (raw as { points: unknown[] }).points
      : [];

  const seen = new Set<string>();
  const points: CoachPreparationAttentionPoint[] = [];
  for (const item of source) {
    const candidate = typeof item === "string" ? item : String((item as { text?: unknown } | null)?.text ?? "");
    const text = candidate.replace(/\s+/g, " ").trim();
    const key = text.toLocaleLowerCase("fr-CH");
    if (!text || text.length > COACH_PREPARATION_POINT_MAX_LENGTH || seen.has(key)) continue;
    seen.add(key);
    points.push({ text });
    if (points.length === COACH_PREPARATION_MAX_POINTS) break;
  }
  return points;
}

export function isFutureTraining(event: { event_type: string; starts_at: string }, now = new Date()) {
  const startsAt = new Date(event.starts_at).getTime();
  return event.event_type === "training" && Number.isFinite(startsAt) && startsAt > now.getTime();
}

export function completedBefore(
  event: { starts_at: string; ends_at: string | null; duration_minutes: number | null; status: string },
  boundary: Date
) {
  if (event.status === "cancelled") return false;
  const start = new Date(event.starts_at).getTime();
  if (!Number.isFinite(start)) return false;
  const explicitEnd = event.ends_at ? new Date(event.ends_at).getTime() : Number.NaN;
  const end = Number.isFinite(explicitEnd) ? explicitEnd : start + Math.max(0, Number(event.duration_minutes ?? 0)) * 60_000;
  return end <= boundary.getTime();
}
