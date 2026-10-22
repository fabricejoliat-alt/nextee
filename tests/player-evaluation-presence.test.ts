import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";

const player = "00000000-0000-4000-8000-000000000001";
function setup(options: { rpcError?: Row; failureTable?: string } = {}) {
  const tables: Record<string, Row[]> = {
    club_events: [{ id: "event", club_id: "club", group_id: "group", event_type: "training", status: "scheduled" }],
    club_event_attendees: [{ event_id: "event", player_id: player, status: "present", coach_recorded_status: "present" }],
    training_sessions: [{ id: "session", club_event_id: "event", user_id: player, motivation: 5, difficulty: 4, satisfaction: 6 }],
    club_event_player_feedback: [], club_event_evaluation_responses: [],
  };
  const h = managerDatabase(tables, options);
  const mocks = {
    "@supabase/supabase-js": { createClient: () => h.db },
    "@/app/api/messages/_lib": { requireCaller: async () => ({ callerId: "coach", supabaseAdmin: h.db }) },
    "@/lib/coachAccess": { canCoachAccessEvent: async () => true, requireCoachEventPlayer: async () => {} },
    "@/app/api/coach/events/_access": { requireCoachEventAccess: async () => tables.club_events[0] },
    "@/lib/server/coachEvaluationNotifications": { notifyCoachPlayerEvaluation: async () => ({ created: false }) },
  };
  const attendance = loadManagerModule("app/api/coach/events/[eventId]/attendance/route.ts", mocks);
  const debrief = loadManagerModule("app/api/coach/events/[eventId]/debrief/player/route.ts", mocks);
  const locks = loadManagerModule("lib/server/playerEvaluationPresence.ts", mocks);
  const request = (status: string, method = "POST") => new Request("https://example.invalid/api/coach/events/event/attendance", {
    method, headers: { authorization: "Bearer test", "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: player, player_id: player, status, engagement: 4, attitude: 5, performance: 6, expected_recorded_at: null }),
  });
  return { ...h, tables, attendance, debrief, locks, request, ctx: { params: Promise.resolve({ eventId: "event" }) } };
}

test("a saved training self-evaluation locks attendance without a legacy feedback or coach evaluation", async () => {
  const h = setup();
  const result = await h.attendance.GET(new Request("https://example.invalid", { headers: { authorization: "Bearer test" } }), h.ctx);
  assert.deepEqual((await result.json()).lockedPlayerIds, [player]);
  const direct = await h.attendance.POST(h.request("absent"), h.ctx);
  const guided = await h.debrief.PUT(h.request("absent", "PUT"), h.ctx);
  for (const response of [direct, guided]) {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "attendance_locked_by_player_evaluation");
  }
  assert.equal(h.writes.length, 0); assert.equal(h.rpcs.length, 0);
});

test("the coach can still edit ratings while keeping the evaluated player's presence", async () => {
  const h = setup();
  assert.equal((await h.debrief.PUT(h.request("present", "PUT"), h.ctx)).status, 200);
  assert.equal(h.rpcs.length, 1);
  assert.equal(h.rpcs[0].args.p_status, "present");
  assert.equal(h.rpcs[0].args.p_engagement, 4);
});

test("empty session shells and other players or events do not lock attendance", async () => {
  const h = setup();
  h.tables.training_sessions = [
    { id: "empty", club_event_id: "event", user_id: player, motivation: null, difficulty: null, satisfaction: null },
    { id: "other", club_event_id: "other-event", user_id: player, motivation: 4 },
    { id: "other-player", club_event_id: "event", user_id: "other", motivation: 4 },
  ];
  assert.equal((await h.attendance.POST(h.request("absent"), h.ctx)).status, 200);
  assert.equal(h.writes.length, 1);
});

test("legacy ratings and saved custom answers, including false and zero, also lock attendance", async () => {
  const h = setup(); h.tables.training_sessions = [];
  h.tables.club_event_player_feedback = [{ event_id: "event", player_id: player, motivation: 3 }];
  assert.equal((await h.locks.playerEvaluationLockedIds(h.db, "event")).has(player), true);
  h.tables.club_event_player_feedback = [];
  for (const value of [false, 0, "answer", null, ""]) {
    h.tables.club_event_evaluation_responses = [{ event_id: "event", player_id: player, respondent_role: "player", value_json: value }];
    assert.equal((await h.locks.playerEvaluationLockedIds(h.db, "event")).has(player), value !== null && value !== "");
  }
  h.tables.club_event_evaluation_responses[0] = { event_id: "event", player_id: player, respondent_role: "coach", value_json: true };
  assert.equal((await h.locks.playerEvaluationLockedIds(h.db, "event")).has(player), false);
});

test("a missing presence can be confirmed after self-evaluation but absence cannot", async () => {
  const h = setup(); Object.assign(h.tables.club_event_attendees[0], { status: "expected", coach_recorded_status: null });
  assert.equal((await h.debrief.PUT(h.request("present", "PUT"), h.ctx)).status, 200);
  assert.equal((await h.debrief.PUT(h.request("absent", "PUT"), h.ctx)).status, 409);
});

test("a self-evaluation arriving during save returns a conflict from the database guard", async () => {
  const h = setup({ rpcError: { message: "attendance_locked_by_player_evaluation" } });
  h.tables.training_sessions = [];
  const result = await h.debrief.PUT(h.request("absent", "PUT"), h.ctx);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "attendance_locked_by_player_evaluation");
});

test("failure to read self-evaluations fails closed before writing attendance", async () => {
  const h = setup({ failureTable: "training_sessions" });
  assert.equal((await h.attendance.POST(h.request("absent"), h.ctx)).status, 503);
  assert.equal(h.writes.length, 0);
  assert.equal(h.rpcs.length, 0);
});
