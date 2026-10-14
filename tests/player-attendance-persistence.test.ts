/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated server and browser fixtures without network access. */
import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";

function fixture() {
  const future = new Date(Date.now() + 86400000).toISOString();
  const tables = { club_events: [{ id: "event", club_id: "club", group_id: "group", event_type: "training", status: "scheduled", starts_at: future, ends_at: future, duration_minutes: 60 }],
    club_event_attendees: [{ event_id: "event", player_id: "junior", status: "present", coach_recorded_status: null }],
    club_event_coach_feedback: [] as Row[] };
  const h = managerDatabase(tables);
  const originalFrom = h.db.from.bind(h.db);
  h.db.from = (table: string) => {
    const query = originalFrom(table);
    const originalThen = query.then.bind(query);
    query.then = (yes: any, no: any) => originalThen((result: any) => {
      const write = h.writes.at(-1);
      if (table === "club_event_attendees" && write?.table === table && write.method === "update" && !result.error) {
        for (const row of write.rows) Object.assign(row, write.values);
      }
      return yes(result);
    }, no) as any;
    return query;
  };
  const access = { supabaseAdmin: h.db, organizationIds: ["club"], actorUserId: "parent", subjectPlayerId: "junior" };
  const notifications: Row[] = [];
  const mocks = { "@/app/api/player/access": { bearerTokenFromRequest: () => "token", playerAccessErrorStatus: () => 403,
    resolveAuthenticatedPlayerAccess: async () => access },
    "@/lib/server/playerAttendanceNotifications": { notifyPlayerAttendance: async (_db: unknown, input: Row) => { notifications.push(input); } } };
  const stateModule = loadManagerModule("lib/server/playerTrainingAttendance.ts", mocks);
  const route = loadManagerModule("app/api/player/training-attendance/route.ts", mocks);
  const request = (status = "absent") => new Request("https://example.invalid/api/player/training-attendance?child_id=junior", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: "event", status }) });
  return { ...h, tables, access, notifications, stateModule, route, request, mocks };
}

test("future attendance persists for the resolved junior and notifies the coach after confirmation", async () => {
  const h = fixture();
  const response = await h.route.PATCH(h.request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "absent");
  const reloaded = await h.stateModule.readPastTrainingAttendanceState(h.access, "event", { allowUpcoming: true });
  assert.equal(reloaded.status, "absent");
  assert.equal(h.tables.club_event_attendees[0].status, "absent");
  assert.deepEqual(h.notifications, [{ actorId: "parent", playerId: "junior", eventId: "event", status: "absent" }]);
  await h.route.PATCH(h.request());
  assert.equal(h.notifications.length, 1, "An unchanged status must not send a duplicate notification");
  await h.route.PATCH(h.request("present"));
  assert.equal(h.tables.club_event_attendees[0].status, "present");
  assert.equal(h.notifications.length, 2);
});

test("past unevaluated attendance is saved; recorded evaluations and cancelled events remain locked", async () => {
  const h = fixture();
  h.tables.club_events[0].starts_at = h.tables.club_events[0].ends_at = "2026-01-01T10:00:00Z";
  assert.equal((await h.route.PATCH(h.request())).status, 200);
  h.tables.club_event_coach_feedback.push({ event_id: "event", player_id: "junior" });
  assert.equal((await h.route.PATCH(h.request("present"))).status, 409);
  assert.equal(h.tables.club_event_attendees[0].status, "absent");
  h.tables.club_event_coach_feedback.length = 0;
  h.tables.club_events[0].status = "cancelled";
  assert.equal((await h.route.PATCH(h.request("present"))).status, 409);
  assert.equal(h.notifications.length, 1);
});

test("a missing attendee row or inaccessible club cannot report success or notify", async () => {
  const h = fixture(); h.tables.club_event_attendees.length = 0;
  assert.equal((await h.route.PATCH(h.request())).status, 404);
  h.tables.club_event_attendees.push({ event_id: "event", player_id: "other", status: "present", coach_recorded_status: null });
  assert.equal((await h.route.PATCH(h.request())).status, 404);
  h.access.organizationIds = ["other-club"];
  assert.equal((await h.route.PATCH(h.request())).status, 404);
  assert.equal(h.writes.length, 0); assert.equal(h.notifications.length, 0);
});

test("the browser rejects silent no-op responses and invalidates cached pages only after confirmation", async () => {
  const invalidations: string[] = []; const requests: Row[] = [];
  let result: Row = {}; let ok = true;
  const client = loadManagerModule("lib/playerAttendanceWrite.ts", {
    "@/lib/supabaseClient": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } } },
    "@/lib/organizationFetch": { organizationFetch: async (url: string, init: Row) => { requests.push({ url, ...init }); return { ok, status: ok ? 200 : 409, json: async () => result }; } },
    "@/lib/clientPageCache": { invalidateClientPageCacheByPrefix: (prefix: string) => invalidations.push(prefix) },
  });
  await assert.rejects(client.savePlayerAttendance("junior", "event", "absent"));
  assert.equal(invalidations.length, 0);
  ok = false; await assert.rejects(client.savePlayerAttendance("junior", "event", "absent"));
  assert.equal(invalidations.length, 0);
  ok = true; result = { status: "absent", notificationWarning: true };
  assert.deepEqual(await client.savePlayerAttendance("junior", "event", "absent"), result);
  assert.deepEqual(invalidations, ["page-cache:player-home:", "page-cache:player-trainings:"]);
  assert.equal(requests[0].headers.Authorization, "Bearer token");
  assert.equal(requests[0].url.includes("child_id=junior"), true);
});

test("attendance notification creates a coach inbox item and sends push to authorized assigned coaches", async () => {
  const h = managerDatabase({ club_events: [{ id: "event", club_id: "club", group_id: "group", starts_at: "2026-10-20T15:00:00Z", event_type: "training" }],
    profiles: [{ id: "junior", first_name: "Léa", last_name: "Exemple" }],
    club_event_coaches: [{ event_id: "event", coach_id: "coach" }, { event_id: "event", coach_id: "coach" }] });
  h.db.rpc = async () => ({ data: true, error: null }) as any;
  const pushes: Row[] = [];
  const notificationModule = loadManagerModule("lib/server/playerAttendanceNotifications.ts", {
    "@/lib/server/notificationTemplates": { serverNotificationMessage: async () => ({ title: "Absence", body: "Léa est absente" }), notificationTemplateData: (input: Row) => input },
    "@/lib/server/webPush": { sendWebPush: async (_db: unknown, input: Row) => { pushes.push(input); return { failed: 0 }; } },
  });
  await notificationModule.notifyPlayerAttendance(h.db, { actorId: "junior", playerId: "junior", eventId: "event", status: "absent" });
  assert.equal(h.writes.find(write => write.table === "notifications")?.values.kind, "player_marked_absent");
  assert.deepEqual(h.writes.find(write => write.table === "notification_recipients")?.values, [{ notification_id: "created", user_id: "coach" }]);
  assert.deepEqual(pushes[0].recipientUserIds, ["coach"]);
  assert.equal(pushes[0].url, "/coach/groups/group/planning/event");
});


test("a coach attendance change between read and write returns a conflict without notifying", async () => {
  const h = fixture();
  const routeModule = loadManagerModule("app/api/player/training-attendance/route.ts", { ...h.mocks,
    "@/lib/server/playerTrainingAttendance": { ...h.stateModule, readPastTrainingAttendanceState: async (...args: any[]) => {
      const state = await h.stateModule.readPastTrainingAttendanceState(...args);
      h.tables.club_event_attendees[0].coach_recorded_status = "present" as any;
      return state;
    } },
  });
  assert.equal((await routeModule.PATCH(h.request())).status, 409);
  assert.equal(h.tables.club_event_attendees[0].status, "present");
  assert.equal(h.notifications.length, 0);
});

test("a notification failure preserves the saved attendance and reports a warning", async () => {
  const h = fixture();
  const routeModule = loadManagerModule("app/api/player/training-attendance/route.ts", { ...h.mocks,
    "@/lib/server/playerAttendanceNotifications": { notifyPlayerAttendance: async () => { throw new Error("Push unavailable"); } },
  });
  const response = await routeModule.PATCH(h.request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).notificationWarning, true);
  assert.equal(h.tables.club_event_attendees[0].status, "absent");
});
