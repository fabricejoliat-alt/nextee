/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated database and route fixtures, without network access. */
import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";
import { coachCalendarActionState } from "../lib/coachCalendar.ts";
import { coachPlanningView } from "../lib/coachPlanning.ts";

const event = (id: string, club_id = "A") => ({ id, club_id, group_id: `group-${club_id}`, event_type: "training", status: "scheduled",
  starts_at: "2026-01-01T09:00:00Z", ends_at: "2026-01-01T10:00:00Z", duration_minutes: 60, requires_evaluation: true });
const attendee = (event_id: string, player_id: string, status: string | null = null) => ({ event_id, player_id, coach_recorded_status: status });
const feedback = (event_id: string, player_id: string) => ({ event_id, player_id, engagement: 4, attitude: 5, performance: 6 });
const member = (user_id: string, changes: Row = {}) => ({ user_id, club_id: "A", role: "player", is_active: true,
  player_consent_status: "granted", current_authorization: true, ...changes });
const loader = loadManagerModule("lib/server/coachEvaluation.ts", {});

function fixture(overrides: Record<string, Row[]> = {}, failedRpc = false) {
  const tables = {
    club_events: [event("mixed"), event("blocked"), event("other", "B"), event("empty")],
    club_members: [member("done"), member("inactive", { is_active: false }), member("pending", { player_consent_status: "pending" }),
      member("refused", { player_consent_status: "refused" }), member("old-version", { current_authorization: false }), member("suspended"),
      member("done", { club_id: "B", player_consent_status: "pending" })],
    club_event_attendees: [attendee("mixed", "done", "present"), attendee("mixed", "inactive"), attendee("mixed", "pending"), attendee("mixed", "refused"),
      attendee("blocked", "inactive"), attendee("blocked", "old-version"), attendee("blocked", "suspended"), attendee("other", "done")],
    club_event_coach_feedback: [feedback("mixed", "done"), feedback("blocked", "inactive")],
    academy_roster_entries: [{ academy_id: "A", player_id: "suspended", status: "suspended" }],
    coach_groups: [{ id: "group-A", club_id: "A", name: "Juniors", head_coach_user_id: "coach", is_active: true }],
    coach_group_players: [{ group_id: "group-A", player_user_id: "done" }],
    organizations: [{ id: "A", name: "Club témoin" }],
    ...overrides,
  };
  const h = managerDatabase(tables, { caller: "coach" });
  const calls: Row[] = [];
  Object.assign(h.db, { rpc: async (name: string, args: Row) => {
    calls.push({ name, ...args });
    if (name === "organization_actor_legal_ready") return { data: true, error: null };
    assert.equal(name, "organization_player_authorized");
    // Stand-in for the existing SQL authorization predicate; never substitute the legacy granted flag in production.
    const row = tables.club_members.find(m => m.user_id === args.p_player && m.club_id === args.p_org && m.role === "player");
    return { data: Boolean(row?.is_active && (row.player_consent_status === "adult" || row.player_consent_status === "granted" && row.current_authorization)),
      error: failedRpc ? { message: "authorization unavailable" } : null };
  } });
  return { ...h, tables, calls };
}

test("1/4 becomes 1/1 when three juniors cannot be evaluated; historical rows remain intact", async () => {
  const h = fixture(); const snapshot = JSON.stringify(h.tables);
  const state = await loader.loadCoachEvaluationWorkload(h.db, ["mixed", "blocked", "other", "empty"]);
  assert.deepEqual(state.progressByEvent.mixed, { totalPlayers: 1, completedPlayers: 1, remainingPlayers: 0 });
  assert.equal(state.completeByEvent.mixed, true);
  for (const id of ["blocked", "other", "empty"]) {
    assert.deepEqual(state.progressByEvent[id], { totalPlayers: 0, completedPlayers: 0, remainingPlayers: 0 });
    assert.equal(state.completeByEvent[id], false, "Exclusion must not fabricate a saved evaluation");
  }
  assert.deepEqual(state.attendees.map((row: Row) => row.player_id), ["done"]);
  assert.deepEqual(state.feedback.map((row: Row) => row.player_id), ["done"]);
  const historical = await loader.loadCoachEvaluationState(h.db, ["blocked"]);
  assert.equal(historical.attendees.length, 3);
  assert.equal(historical.feedback[0].player_id, "inactive");
  assert.equal(JSON.stringify(h.tables), snapshot);
  assert.deepEqual(h.writes, []);
  assert(!h.calls.some(call => call.p_player === "suspended"));
});

test("active adults and absent juniors count normally; required answers and incomplete ratings still block completion", async () => {
  const h = fixture({ club_members: [member("adult", { player_consent_status: "adult" }), member("absent"), member("partial")],
    club_event_attendees: [attendee("mixed", "adult", "present"), attendee("mixed", "absent", "absent"), attendee("mixed", "partial", "present")],
    club_event_coach_feedback: [feedback("mixed", "adult"), { ...feedback("mixed", "partial"), performance: null }],
    club_event_evaluation_criteria: [{ id: "required", event_id: "mixed", is_enabled: true, snapshot_respondent: "coach", snapshot_is_required: true,
      snapshot_response_format: "yes_no", snapshot_choices: [{ value: true }, { value: false }] }],
    club_event_evaluation_responses: [{ event_id: "mixed", player_id: "adult", event_criterion_id: "required", respondent_role: "coach", value_json: false }],
  });
  const state = await loader.loadCoachEvaluationWorkload(h.db, ["mixed"]);
  assert.deepEqual(state.progressByEvent.mixed, { totalPlayers: 3, completedPlayers: 2, remainingPlayers: 1 });
});

test("authorization is organization-scoped, refreshed after reactivation and checked once across a long season", async () => {
  const events = Array.from({ length: 151 }, (_, i) => event(`event-${i}`));
  const h = fixture({ club_events: [...events, event("other", "B")],
    club_event_attendees: [...events.map(row => attendee(row.id, "done")), attendee("other", "done")] });
  let state = await loader.loadCoachEvaluationWorkload(h.db, [...events.map(row => row.id), "other"]);
  assert.equal(state.attendees.length, 151);
  assert.equal(h.calls.length, 2, "Do not repeat authorization for each training");
  assert.deepEqual(new Set(h.calls.map(call => call.p_org)), new Set(["A", "B"]));
  h.tables.club_members.find(row => row.user_id === "done" && row.club_id === "B")!.player_consent_status = "granted";
  state = await loader.loadCoachEvaluationWorkload(h.db, ["other"]);
  assert.equal(state.progressByEvent.other.remainingPlayers, 1);
  h.tables.club_members.find(row => row.user_id === "done" && row.club_id === "B")!.is_active = false;
  state = await loader.loadCoachEvaluationWorkload(h.db, ["other"]);
  assert.equal(state.progressByEvent.other.remainingPlayers, 0);
});

test("a consent lookup failure never turns an unknown state into zero outstanding work", async () => {
  const h = fixture({}, true);
  await assert.rejects(loader.loadCoachEvaluationWorkload(h.db, ["mixed"]), /authorization unavailable/);
  assert.deepEqual(h.writes, []);
});

function routeMocks(h: ReturnType<typeof fixture>) {
  return { ...h.mocks, "@/lib/coachAccess": {
    resolveCoachAssignments: async () => ({ clubIds: ["A"], groups: [{ id: "group-A", club_id: "A" }], eventIds: [] }),
    authorizedCoachPlayers: async () => new Set(["done"]),
  }, "@/lib/server/coachPreparationStatus": { loadCoachPreparationStatus: async () => ({}) },
  "@/lib/server/coachClubCount": { coachClubCount: async () => 1 } };
}
const request = (path: string) => new Request(`https://app.invalid${path}`, { headers: { authorization: "Bearer fixture" } });

test("home attention list and badge total drop sessions whose eligible juniors are already evaluated", async () => {
  const h = fixture(); const route = loadManagerModule("app/api/coach/home/route.ts", routeMocks(h));
  let response = await route.GET(request("/api/coach/home")); let body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.pendingEvalEvents, []);
  assert.equal(body.pendingEvaluationCount, 0); assert.equal(body.pendingAttendanceCount, 0);
  h.tables.club_event_coach_feedback[0].performance = null;
  response = await route.GET(request("/api/coach/home")); body = await response.json();
  assert.equal(body.pendingEvaluationCount, 1);
  assert.deepEqual(body.pendingEvalEvents.map((row: Row) => [row.id, row.completedPlayers, row.totalPlayers, row.remainingPlayers]), [["mixed", 0, 1, 1]]);
});

test("calendar and group planning keep all activities visible and remove blocked ones from the evaluation queue", async () => {
  const h = fixture({ club_members: [...fixture().tables.club_members, { user_id: "coach", club_id: "A", role: "coach", is_active: true }] });
  const route = loadManagerModule("app/api/coach/events/calendar/route.ts", routeMocks(h));
  const response = await route.GET(request("/api/coach/events/calendar")); const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const states = Object.fromEntries(body.events.map((row: Row) => [row.id,
    coachCalendarActionState(row as any, body.trainingEvaluationCompleteByEventId[row.id], Date.now())]));
  assert.deepEqual(states, { mixed: "evaluation_complete", blocked: "view_activity", empty: "view_activity" });
  const planningModule = loadManagerModule("lib/server/coachGroupPlanning.ts", routeMocks(h));
  const planning = await planningModule.loadCoachGroupPlanning(h.db, "coach", "group-A");
  assert.equal(planning.events.length, 3);
  assert.equal(coachPlanningView(planning.events, "all", "pending", Date.now()).events.length, 0);
  assert.equal(planning.events.find((row: Row) => row.id === "blocked").evaluation_complete, false);
  assert.equal(planning.events.find((row: Row) => row.id === "blocked").evaluation_eligible_count, 0);
});
