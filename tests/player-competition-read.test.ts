import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

function fixture({ attendee = true, club = "club", type = "competition" } = {}) {
  const { db, mocks } = managerDatabase({
    club_events: [{ id: "event", club_id: club, group_id: "group", event_type: type, title: "Junior competition" }],
    club_event_attendees: attendee ? [{ event_id: "event", player_id: "junior", status: "present" }] : [],
    organizations: [{ id: "club", name: "Club" }],
    coach_groups: [{ id: "group", name: "Juniors" }],
    club_members: [{ club_id: "club", user_id: "junior", is_active: true }],
    club_event_reminders: [{ event_id: "event", status: "cancelled" }],
  });
  return loadManagerModule<{ GET: (req: Request, context: { params: Promise<{ eventId: string }> }) => Promise<Response> }>(
    "app/api/player/competitions/[eventId]/route.ts", {
      ...mocks,
      "@/app/api/player/access": {
        bearerTokenFromRequest: () => "test-token",
        resolveAuthenticatedPlayerAccess: async () => ({ supabaseAdmin: db, subjectPlayerId: "junior", organizationIds: ["club"] }),
        playerAccessErrorStatus: () => 500,
      },
    });
}
function read(route: ReturnType<typeof fixture>) {
  return route.GET(new Request("http://localhost/api/player/competitions/event"), { params: Promise.resolve({ eventId: "event" }) });
}

test("competition details retain attendance and labels and hide cancelled reminders", async () => {
  const response = await read(fixture());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.event.id, "event");
  assert.equal(data.attendanceStatus, "present");
  assert.equal(data.clubName, "Club");
  assert.equal(data.groupName, "Juniors");
  assert.equal(data.reminder, null);
});

test("reading an event requires the player's attendee record", async () => {
  assert.equal((await read(fixture({ attendee: false }))).status, 403);
});

test("an attendee record cannot expose an event in another organization", async () => {
  const response = await read(fixture({ club: "foreign" }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).event, undefined);
});

test("the competition endpoint still rejects other activity types", async () => {
  assert.equal((await read(fixture({ type: "training" }))).status, 400);
});
