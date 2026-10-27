/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated evaluation transaction and delivery fixtures. */
import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

const playerId = "11111111-1111-4111-8111-111111111111";
const event = { id: "event", club_id: "club", event_type: "training", starts_at: "2026-10-13T15:00:00Z" };
const recordedAt = "2026-10-13T20:00:00Z";

function saving(options: { status?: string; saveError?: boolean; notifyError?: boolean } = {}) {
  const { db } = managerDatabase({ club_event_attendees: [{ event_id: event.id, player_id: playerId }] });
  const order: string[] = [], notifications: any[] = [];
  Object.assign(db, { rpc: async () => { order.push("commit"); return { data: { recorded_at: recordedAt }, error: options.saveError ? { message: "evaluation_conflict" } : null }; } });
  const route = loadManagerModule<any>("app/api/coach/events/[eventId]/debrief/player/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/messages/_lib": { requireCaller: async () => ({ supabaseAdmin: db, callerId: "coach" }) },
    "@/app/api/coach/events/_access": { requireCoachEventAccess: async () => event },
    "@/lib/coachAccess": { requireCoachEventPlayer: async () => {} },
    "@/lib/server/coachEvaluationNotifications": { notifyCoachPlayerEvaluation: async (_db: unknown, input: unknown) => {
      order.push("notify"); notifications.push(input); if (options.notifyError) throw new Error("offline");
      return { created: true, push: { sent: 1, failed: 0 } };
    } },
  });
  return { order, notifications, run: () => route.PUT(new Request("https://app.invalid/api/coach/events/event/debrief/player", {
    method: "PUT", headers: { authorization: "Bearer fixture", "Content-Type": "application/json" },
    body: JSON.stringify({ player_id: playerId, status: options.status ?? "present", engagement: 4, attitude: 5, performance: 6,
      expected_recorded_at: null, player_note: "private player source", private_note: "confidential coach note", custom_responses: {} }),
  }), { params: Promise.resolve({ eventId: event.id }) }) };
}

test("a committed Coach evaluation triggers notification once, with the trusted actor and saved version", async () => {
  const fixture = saving(); const response = await fixture.run();
  assert.equal(response.status, 200); assert.deepEqual(fixture.order, ["commit", "notify"]);
  assert.deepEqual(fixture.notifications, [{ actorUserId: "coach", playerId, event, recordedAt }]);
});

test("conflicted or absent evaluations cannot send a completed-evaluation notification", async () => {
  for (const options of [{ saveError: true }, { status: "absent" }]) {
    const fixture = saving(options); const response = await fixture.run();
    assert.equal(response.status, options.saveError ? 409 : 200); assert.equal(fixture.notifications.length, 0);
  }
});

test("a notification failure never reports the committed evaluation as failed or asks for a duplicate save", async () => {
  const fixture = saving({ notifyError: true }); const response = await fixture.run();
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.ok, true);
  assert.equal(result.recordedAt, recordedAt); assert.equal(result.notification.failed, true);
});

function delivery(duplicate = false) {
  const h = managerDatabase({ notifications: duplicate ? [{ id: "existing", kind: "coach_player_evaluated", data: { event_id: event.id, player_id: playerId, evaluation_recorded_at: recordedAt } }] : [],
    player_guardian_scopes: [
      { organization_id: "club", player_id: playerId, guardian_user_id: "allowed-parent", status: "active", can_view: true },
      { organization_id: "club", player_id: playerId, guardian_user_id: "denied-parent", status: "active", can_view: true },
      { organization_id: "other-club", player_id: playerId, guardian_user_id: "other-parent", status: "active", can_view: true },
      { organization_id: "club", player_id: playerId, guardian_user_id: "revoked-parent", status: "revoked", can_view: true },
    ],
  });
  Object.assign(h.db, { rpc: async (_name: string, args: any) => ({ data: [playerId, "allowed-parent"].includes(args.p_actor), error: null }) });
  const sends: any[] = [];
  const module = loadManagerModule<any>("lib/server/coachEvaluationNotifications.ts", {
    "@/lib/server/webPush": { sendWebPush: async (_db: unknown, input: unknown) => { sends.push(input); return { sent: 2, failed: 0 }; } },
  });
  return { ...h, sends, run: () => module.notifyCoachPlayerEvaluation(h.db, { actorUserId: "coach", playerId, event, recordedAt }) };
}

test("evaluation alerts reach only the player and authorized parents of this organization, without ratings or private notes", async () => {
  const fixture = delivery(); const result = await fixture.run();
  assert.equal(result.recipients, 2); assert.deepEqual(fixture.sends[0].recipientUserIds, [playerId, "allowed-parent"]);
  const notification = fixture.writes.find(write => write.table === "notifications")!;
  assert.equal(notification.values.kind, "coach_player_evaluated");
  assert.equal(notification.values.club_id, "club");
  assert.match(notification.values.data.url, /\/player\/golf\/activities\/event\?child_id=/);
  assert.doesNotMatch(JSON.stringify(fixture.sends), /engagement|performance|attitude|private_note|player_note/);
  assert.equal(fixture.writes.find(write => write.table === "notification_recipients")!.values.length, 2);
});

test("the same saved evaluation version cannot create or dispatch another notification", async () => {
  const fixture = delivery(true); const result = await fixture.run();
  assert.equal(result.duplicate, true); assert.equal(fixture.writes.length, 0); assert.equal(fixture.sends.length, 0);
});
