import assert from "node:assert/strict";
import test from "node:test";
import { playerGolfOverviewStats } from "../lib/playerGolfOverviewStats.ts";

test("monthly and season attendance use confirmed club activities only", () => {
  const stats = playerGolfOverviewStats({
    now: new Date("2026-10-13T12:00:00"),
    events: [
      { id: "previous", event_type: "training", starts_at: "2026-09-12T09:00:00", ends_at: "2026-09-12T10:00:00", status: "scheduled" },
      { id: "present", event_type: "training", starts_at: "2026-10-10T09:00:00", ends_at: "2026-10-10T10:00:00", status: "scheduled" },
      { id: "absent", event_type: "camp", starts_at: "2026-10-11T09:00:00", ends_at: "2026-10-11T10:00:00", status: "scheduled" },
      { id: "cancelled", event_type: "training", starts_at: "2026-10-12T09:00:00", ends_at: "2026-10-12T10:00:00", status: "cancelled" },
      { id: "competition", event_type: "competition", starts_at: "2026-10-12T09:00:00", ends_at: "2026-10-12T10:00:00", status: "scheduled" },
      { id: "unconfirmed", event_type: "training", starts_at: "2026-10-12T09:00:00", ends_at: "2026-10-12T10:00:00", status: "scheduled" },
    ],
    attendance: { previous: "absent", present: "present", absent: "absent", cancelled: "present", competition: "present", unconfirmed: "expected" },
    sessions: [], personalActivities: [],
  });
  assert.deepEqual(stats.month, { present: 1, total: 2, rate: 50, trend: 50 });
  assert.deepEqual(stats.season, { present: 1, total: 3, rate: 33 });
});

test("upcoming count includes club, standalone, and personal activities", () => {
  const stats = playerGolfOverviewStats({
    now: new Date("2026-10-13T12:00:00Z"), attendance: {},
    events: [
      { id: "club", event_type: "training", starts_at: "2026-10-14T09:00:00Z", ends_at: "2026-10-14T10:00:00Z", status: "scheduled" },
      { id: "cancelled", event_type: "training", starts_at: "2026-10-14T09:00:00Z", ends_at: "2026-10-14T10:00:00Z", status: "cancelled" },
    ],
    sessions: [
      { start_at: "2026-10-14T09:00:00Z", total_minutes: 60, session_type: "club", club_event_id: "club" },
      { start_at: "2026-10-15T09:00:00Z", total_minutes: 60, session_type: "individual", club_event_id: null },
    ],
    personalActivities: [
      { event_type: "competition", starts_at: "2026-10-16T09:00:00Z", ends_at: "2026-10-16T10:00:00Z", status: "scheduled" },
      { event_type: "camp", starts_at: "2026-10-11T09:00:00Z", ends_at: "2026-10-11T10:00:00Z", status: "scheduled" },
    ],
  });
  assert.equal(stats.upcoming, 3);
  assert.deepEqual(Object.fromEntries(stats.upcomingByType), { training: 1, individual: 1, competition: 1 });
});
