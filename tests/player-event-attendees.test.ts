import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

function fixture(eventType = "training", failureTable?: string) {
  const ids = ["lea", "hugo", "jules", "ines", "other-club", "coach-only", "missing-member"];
  const tables = {
    club_events: [{ id: "event", club_id: "club", group_id: "group", event_type: eventType }],
    club_event_attendees: ids.map(player_id => ({ event_id: "event", player_id, status: "present" })),
    coach_group_players: ids.map(player_user_id => ({ group_id: "group", player_user_id })),
    club_members: [
      { club_id: "club", user_id: "lea", role: "player", is_active: true },
      { club_id: "club", user_id: "hugo", role: "player", is_active: true },
      { club_id: "club", user_id: "jules", role: "player", is_active: false },
      { club_id: "club", user_id: "ines", role: "player", is_active: false },
      { club_id: "elsewhere", user_id: "ines", role: "player", is_active: true },
      { club_id: "elsewhere", user_id: "other-club", role: "player", is_active: true },
      { club_id: "club", user_id: "coach-only", role: "coach", is_active: true },
    ],
    profiles: ids.map(id => ({ id, first_name: id, last_name: "Fixture", avatar_url: null })),
    club_camp_days: [{ event_id: "event", camp_id: "camp" }],
    club_camp_players: ids.map(player_id => ({ camp_id: "camp", player_id, registration_status: "registered" })),
  };
  const { db, mocks, writes } = managerDatabase(tables, { failureTable });
  const route = loadManagerModule<{ GET(req: Request): Promise<Response> }>("app/api/player/event-attendees/route.ts", {
    ...mocks,
    "@/app/api/player/access": {
      bearerTokenFromRequest: () => "permitted",
      resolveAuthenticatedPlayerAccess: async () => ({ supabaseAdmin: db, subjectPlayerId: "lea", organizationIds: ["club"] }),
      playerAccessErrorStatus: () => 500,
    },
  });
  return { tables, route, writes };
}

const request = () => new Request("http://localhost/api/player/event-attendees?event_id=event");

for (const eventType of ["training", "camp"]) {
  test(`${eventType}: only active players in the event club appear despite stale group links or attendance`, async () => {
    const { route, writes } = fixture(eventType);
    const response = await route.GET(request());
    assert.equal(response.status, 200);
    const { attendees } = await response.json();
    assert.deepEqual(attendees.map((p: { player_id: string }) => p.player_id).sort(), ["hugo", "lea"]);
    assert.ok(attendees.every((p: { status: string }) => p.status === "present"));
    assert.deepEqual(writes, []);
  });
}

test("active group players keep their attendance status, including expected when no attendance exists", async () => {
  const { tables, route } = fixture();
  tables.club_event_attendees = tables.club_event_attendees.filter(row => row.player_id !== "hugo");
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  const { attendees } = await response.json();
  assert.equal(attendees.find((p: { player_id: string }) => p.player_id === "hugo").status, "expected");
});

test("camps still require both registration and actual presence for active players", async () => {
  const { tables, route } = fixture("camp");
  tables.club_event_attendees.find(row => row.player_id === "hugo")!.status = "absent";
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).attendees.map((p: { player_id: string }) => p.player_id), ["lea"]);
});

test("a failed active-membership lookup never falls back to showing inactive players", async () => {
  const { route } = fixture("training", "club_members");
  const response = await route.GET(request());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).attendees, undefined);
});
