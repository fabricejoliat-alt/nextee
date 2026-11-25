/* eslint-disable @typescript-eslint/no-explicit-any -- Fictitious evaluation records and isolated manager/coach loaders. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";

const club = "11111111-1111-4111-8111-111111111111";
function fixture({ players = 10, events = 4, maxRows, incomplete = false }: { players?: number; events?: number; maxRows?: number; incomplete?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    club_members: [{ id: "manager", club_id: club, user_id: "manager", role: "manager", is_active: true }, ...["lead", "assistant"].map(user_id => ({ id: user_id, club_id: club, user_id, role: "coach", is_active: true }))],
    profiles: [{ id: "lead", first_name: "Coach", last_name: "Responsable QA" }, { id: "assistant", first_name: "Coach", last_name: "Assistant QA" }],
    club_seasons: [{ id: "season", club_id: club, starts_on: "2026-09-01", ends_on: "2026-09-30", is_current: true }],
    coach_groups: [{ id: "group", club_id: club, club_season_id: "season", name: "QA", head_coach_user_id: "lead", is_active: true }],
    club_events: Array.from({ length: events }, (_, i) => ({ id: `event-${i}`, club_id: club, group_id: "group", starts_at: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00Z`, duration_minutes: 60, status: "scheduled", event_type: "training", requires_evaluation: true })),
  };
  tables.club_event_coaches = tables.club_events.flatMap(event => ["lead", "assistant"].map(coach_id => ({ event_id: event.id, coach_id })));
  tables.club_event_attendees = tables.club_events.flatMap(event => Array.from({ length: players }, (_, i) => ({ event_id: event.id, player_id: `player-${i}`, status: "present", coach_recorded_status: "present" })));
  tables.club_event_coach_feedback = tables.club_event_attendees.map(row => ({ ...row, coach_id: row.event_id === "event-0" ? "lead" : "assistant", engagement: 4, attitude: 5, performance: incomplete && row.event_id === "event-0" && row.player_id === "player-0" ? null : 6, visible_to_player: true }));
  const h = managerDatabase(tables, { rpcResult: true, maxRows });
  const route = loadManagerModule("app/api/manager/clubs/[clubId]/performance/coaches/route.ts", h.mocks);
  const loader = loadManagerModule("lib/server/coachEvaluation.ts", h.mocks);
  async function get() {
    const url = new URL("https://test.invalid?season=season&from=2026-09-01&to=2026-09-30");
    const req = Object.assign(new Request(url, { headers: { Authorization: "Bearer test" } }), { nextUrl: url });
    const response = await route.GET(req, { params: Promise.resolve({ clubId: club }) });
    assert.equal(response.status, 200);
    return await response.json();
  }
  return { ...h, tables, get, state: () => loader.loadCoachEvaluationWorkload(h.db, tables.club_events.filter(event => event.event_type === "training" && event.status === "scheduled" && event.requires_evaluation !== false).map(event => event.id)) };
}

test("a 10/40 author-only count becomes 40/40 when all activity/player evaluations are complete, matching Coach", async () => {
  const h = fixture();
  const state = await h.state();
  const { managerEvaluationProgress } = loadManagerModule("lib/managerEvaluationProgress.ts", {});
  const authorOnly = managerEvaluationProgress(state.attendees, state.feedback.filter((row: Row) => row.coach_id === "lead"), state.criteria, state.responses);
  assert.equal(authorOnly.completed.size, 10, "Reproduce the old manager numerator on fictitious records");
  const result = await h.get(); const lead = result.rows.find((row: Row) => row.id === "lead");
  assert.equal(lead.evaluationsExpected, 40);
  assert.equal(lead.evaluationsCompleted, 40);
  assert.equal(lead.evaluationsOverdue, 0);
  assert.equal(lead.evaluationsInProgress, 0);
  assert.equal(lead.evaluationTodo.length, 0);
  assert.equal(Object.values(state.progressByEvent).reduce((sum: number, progress: any) => sum + progress.remainingPlayers, 0), 0);
  assert.equal(result.evaluations.overdue, 0);
  assert.ok(!result.attention.some((row: Row) => row.type === "evaluation"));
  assert.equal(h.writes.length, 0);
});

test("the manager uses all paginated Coach evaluations beyond the raw query row limit", async () => {
  const h = fixture({ players: 1100, events: 1, maxRows: 1000 });
  const result = await h.get(); const lead = result.rows.find((row: Row) => row.id === "lead");
  assert.equal(lead.evaluationsExpected, 1100);
  assert.equal(lead.evaluationsCompleted, 1100);
  assert.equal(lead.evaluationsOverdue, 0);
  assert.equal(h.writes.length, 0);
});

test("genuinely incomplete evaluations remain overdue in both manager and Coach workloads", async () => {
  const h = fixture({ incomplete: true }); const state = await h.state();
  const result = await h.get(); const lead = result.rows.find((row: Row) => row.id === "lead");
  assert.equal(lead.evaluationsExpected, 40);
  assert.equal(lead.evaluationsCompleted, 39);
  assert.equal(lead.evaluationsOverdue, 1);
  assert.equal(lead.evaluationsInProgress, 1);
  assert.equal(state.progressByEvent["event-0"].remainingPlayers, 1);
  assert.deepEqual(lead.evaluationTodo.map((row: Row) => [row.eventId, row.playerId]), [["event-0", "player-0"]]);
});

test("activities that cannot be evaluated in Coach do not create manager evaluation debts", async () => {
  const h = fixture();
  h.tables.club_events[1].event_type = "camp";
  h.tables.club_events[2].requires_evaluation = false;
  h.tables.club_events[3].status = "cancelled";
  const result = await h.get(); const lead = result.rows.find((row: Row) => row.id === "lead");
  assert.equal(lead.evaluationsExpected, 10);
  assert.equal(lead.evaluationsCompleted, 10);
  assert.equal(lead.evaluationsOverdue, 0);
  assert.equal(h.writes.length, 0);
});
