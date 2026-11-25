export const sortingContext = { clubs: [{ id: "club", name: "Club QA" }], clubId: "club", seasons: [{ id: "season", name: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31", is_current: true }], seasonId: "season", loading: false, error: "", setClubId() {}, setSeasonId() {} };
const junior = { avatarUrl: null, active: true, ftemCode: "T1", ageCategory: "U14", attendanceTrend: { status: "stable", change: 0 }, regularityRate: 50, handicapChange: 0, evaluationsExpected: 0, evaluationsCompleted: 0, progression: true, reasons: [] };
export const juniorSortingData = {
  filters: { groups: [], ftem: [], activityTypes: [] }, overview: { activeJuniors: 3, attendanceRate: 50, medianActivities: 2, medianTrainingMinutes: 90, progressing: 2, evaluationCoverage: 0, competitionParticipation: 50, dataCompleteness: 100 },
  attendance: { monthly: [], present: 1, absent: 1, excused: 0, pending: 0, assiduous: 0 },
  competition: { participating: 2, medianCompetitions: 1, rounds: 12, missingResults: 0 }, attention: [],
  byGroup: [{ id: "beta", label: "Beta", count: 2, attendanceRate: null, medianTrainingMinutes: 400 }, { id: "alpha", label: "Alpha", count: 10, attendanceRate: 0, medianTrainingMinutes: 80 }, { id: "gamma", label: "Gamma", count: 4, attendanceRate: 90, medianTrainingMinutes: 1000 }],
  rows: [
    { ...junior, id: "zoe", memberId: "zoe-member", name: "Zoé", groupName: "B", attendance: { rate: 20, denominator: 10, present: 2, pending: 0 }, trainingMinutes: 90, objectiveRate: 5, competitions: 2, rounds: 2, progressionSignals: [{ kind: "attendance", value: 30 }] },
    { ...junior, id: "alice", memberId: "alice-member", name: "Alice", groupName: "A", attendance: { rate: 90, denominator: 10, present: 9, pending: 0 }, trainingMinutes: 600, objectiveRate: 100, competitions: 1, rounds: 10, progressionSignals: [{ kind: "handicap", value: 1 }] },
    { ...junior, id: "bea", memberId: "bea-member", name: "Béa", groupName: "C", attendance: { rate: null, denominator: 0, present: 0, pending: 0 }, trainingMinutes: 300, objectiveRate: 0, competitions: 0, rounds: 0, progressionSignals: [] },
  ],
};
const coach = { avatarUrl: null, active: true, function: null, groups: [], headGroupCount: 0, role: "Assistant", previousCoachHours: 0, activeWeeks: 0, camps: 0, evaluationsInProgress: 0, visibleFeedbackRate: null };
export const coachSortingData = {
  filters: { groups: [] }, overview: { activeCoaches: 3, activities: 12, activityHours: 30, coachHours: 40, medianPlayers: 10, coverageRate: 100, evaluationCompletionRate: 80, pendingAttendance: 0 },
  distribution: { medianCoachHours: 10, monthly: [] }, evaluations: { expected: 25, completed: 22, overdue: 3, completionRate: 88 }, coverage: { groupsWithoutHead: [], singleCoachGroups: [], futureWithoutCoach: [] }, attention: [],
  rows: [
    { ...coach, id: "zoe", memberId: "zoe-member", name: "Zoé", groupCount: 2, activities: 2, coachHours: 2, uniquePlayers: 20, medianGroupSize: null, evaluationsRecorded: 3, evaluationsCompleted: 2, evaluationsExpected: 5, evaluationsOverdue: 3, lastActivity: "2026-09-30T10:00:00Z" },
    { ...coach, id: "alice", memberId: "alice-member", name: "Alice", groupCount: 10, activities: 10, coachHours: 10, uniquePlayers: 2, medianGroupSize: 10, evaluationsRecorded: 20, evaluationsCompleted: 20, evaluationsExpected: 20, evaluationsOverdue: 0, lastActivity: "2026-10-01T10:00:00Z" },
    { ...coach, id: "bea", memberId: "bea-member", name: "Béa", groupCount: 0, activities: 0, coachHours: 0, uniquePlayers: 0, medianGroupSize: 0, evaluationsRecorded: 0, evaluationsCompleted: 0, evaluationsExpected: 0, evaluationsOverdue: 0, lastActivity: null },
  ],
};
