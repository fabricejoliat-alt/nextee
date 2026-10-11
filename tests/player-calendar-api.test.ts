import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

function fixture() {
  const tables = {
    club_members: [{ id: "member", user_id: "player", role: "player", is_active: true, is_performance: true }],
    profiles: [{ id: "player", first_name: "Junior", last_name: "Fixture" }],
    organizations: [{ id: "10000000-0000-4000-8000-000000000001", name: "Club" }, { id: "foreign", name: "Foreign" }],
    training_sessions: [
      { id: "complete", user_id: "player", club_id: null, motivation: 0, difficulty: 3, satisfaction: 6 },
      { id: "incomplete", user_id: "player", club_id: "10000000-0000-4000-8000-000000000001", motivation: 3, difficulty: null, satisfaction: 4 },
      { id: "foreign-session", user_id: "player", club_id: "foreign", motivation: 3, difficulty: 3, satisfaction: 3 },
    ],
    training_session_items: [{ id: "item", session_id: "complete", minutes: 30 }, { id: "item2", session_id: "incomplete", minutes: 30 }],
    club_event_attendees: [{ event_id: "event", player_id: "player", status: "present" }, { event_id: "foreign-event", player_id: "player", status: "present" }],
    club_events: [{ id: "event", club_id: "10000000-0000-4000-8000-000000000001", event_type: "camp", status: "scheduled", group_id: "group" }, { id: "foreign-event", club_id: "foreign" }],
    club_camp_days: [{ event_id: "event", camp_id: "cancelled-camp" }],
    club_camps: [{ id: "cancelled-camp", status: "cancelled" }],
    player_camp_days: [{ session_id: "complete", camp_id: "personal-camp", day_index: 0 }],
    player_camps: [{ id: "personal-camp", organization_id: null, title: "Personal camp" }],
    coach_groups: [{ id: "group", club_id: "10000000-0000-4000-8000-000000000001", name: "Group" }],
    player_activity_events: [{ id: "personal", user_id: "player", organization_id: null }],
  };
  const { db, mocks } = managerDatabase(tables);
  const from = db.from.bind(db);
  db.from = ((table: keyof typeof tables) => {
    const query = from(table);
    return Object.assign(query, { or(filter: string) {
      const column = filter.startsWith("club_id") ? "club_id" : "organization_id";
      assert.ok(filter.includes("10000000-0000-4000-8000-000000000001"));
      const ids = tables[table].filter(row => !(row as Record<string, unknown>)[column] || (row as Record<string, unknown>)[column] === "10000000-0000-4000-8000-000000000001").map(row => (row as Record<string, unknown>).id);
      return query.in("id", ids);
    } });
  }) as typeof db.from;
  return loadManagerModule<{ GET: (req: Request) => Promise<Response> }>("app/api/player/trainings/route.ts", {
    ...mocks,
    "@/app/api/player/access": {
      bearerTokenFromRequest: (req: Request) => req.headers.get("Authorization"),
      resolveAuthenticatedPlayerAccess: async ({ accessToken }: { accessToken: string }) => {
        if (accessToken !== "permitted") throw Object.assign(new Error("Forbidden"), { status: 403 });
        return { supabaseAdmin: db, actorUserId: "player", subjectPlayerId: "player", organizationIds: ["10000000-0000-4000-8000-000000000001"] };
      },
      playerAccessErrorStatus: (error: { status?: number }) => error.status ?? 500,
    },
  });
}

test("calendar keeps personal history and completion status while hiding foreign organizations and cancelled camps", async () => {
  const response = await fixture().GET(new Request("http://localhost/api/player/trainings", { headers: { Authorization: "permitted" } }));
  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.deepEqual(data.sessions.map((row: { id: string }) => row.id), ["complete", "incomplete"]);
  assert.deepEqual(data.completedSessionIds, ["complete"]);
  assert.equal(data.sessions[0].player_camp_title, "Personal camp");
  assert.deepEqual(data.attendeeEvents, []);
  assert.ok(!JSON.stringify(data).includes("foreign"));
  assert.equal(data.activeClubCount, 1);
  assert.match(response.headers.get("Server-Timing") ?? "", /access;dur=/);
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
});

test("calendar authorization failure returns no activity data", async () => {
  const response = await fixture().GET(new Request("http://localhost/api/player/trainings"));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
});
