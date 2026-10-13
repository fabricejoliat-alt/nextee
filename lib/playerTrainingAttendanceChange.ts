export type PastTrainingAttendanceState = {
  eventType: string | null;
  eventStatus: string | null;
  eventStartsAt: string;
  eventEndsAt: string | null;
  eventDurationMinutes: number | null;
  coachRecordedStatus: string | null;
  coachFeedbackRecorded: boolean;
  coachResponseRecorded: boolean;
  playerRatings: Array<number | null>;
  playerResponseRecorded: boolean;
};

export function canChangePastTrainingAttendance(state: PastTrainingAttendanceState, now: Date) {
  const startsAt = Date.parse(state.eventStartsAt);
  const explicitEnd = state.eventEndsAt ? Date.parse(state.eventEndsAt) : Number.NaN;
  const endsAt = Number.isFinite(explicitEnd)
    ? explicitEnd
    : startsAt + Math.max(1, Number(state.eventDurationMinutes ?? 0)) * 60_000;
  return state.eventType === "training" && state.eventStatus === "scheduled"
    && Number.isFinite(endsAt) && endsAt < now.getTime()
    && !state.coachRecordedStatus && !state.coachFeedbackRecorded && !state.coachResponseRecorded
    && !state.playerRatings.some((rating) => rating != null) && !state.playerResponseRecorded;
}
