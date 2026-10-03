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
  source_fingerprint: string;
  seen_at?: string | null;
};

type PreparationPrivateNoteInput = {
  feedbackText: string | null | undefined;
  feedbackUpdatedAt: string | null | undefined;
  validatedText: string | null | undefined;
  validatedAt: string | null | undefined;
};

export function selectPreparationPrivateNote(input: PreparationPrivateNoteInput) {
  const feedbackText = String(input.feedbackText ?? "").trim();
  const validatedText = String(input.validatedText ?? "").trim();
  const feedbackTime = Date.parse(String(input.feedbackUpdatedAt ?? ""));
  const validatedTime = Date.parse(String(input.validatedAt ?? ""));
  const feedbackIsNewer = Number.isFinite(feedbackTime)
    && (!Number.isFinite(validatedTime) || feedbackTime > validatedTime);

  if (feedbackIsNewer) {
    return feedbackText
      ? { source: "feedback" as const, text: feedbackText, savedAt: String(input.feedbackUpdatedAt) }
      : null;
  }
  if (validatedText) {
    return {
      source: "validated" as const,
      text: validatedText,
      savedAt: String(input.validatedAt ?? input.feedbackUpdatedAt ?? ""),
    };
  }
  return feedbackText
    ? { source: "feedback" as const, text: feedbackText, savedAt: String(input.feedbackUpdatedAt ?? "") }
    : null;
}

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
