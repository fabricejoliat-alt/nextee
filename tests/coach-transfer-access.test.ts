import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";

function fixture(options: { permission?: boolean; active?: boolean; legal?: boolean; roster?: boolean; playerClub?: string; suspended?: boolean } = {}) {
  const state = managerDatabase({
    coach_groups: [{ id: "source", club_id: "club", name: "Source" }, { id: "destination", club_id: "club", name: "Destination", is_active: true }],
    club_members: [{ id: "staff", club_id: "club", user_id: "coach", role: "coach", is_active: options.active !== false, can_transfer_players_between_club_groups: options.permission !== false },
      { id: "junior", club_id: options.playerClub ?? "club", user_id: "pending", role: "player", is_active: true }],
    coach_group_players: options.roster === false ? [] : [{ group_id: "source", player_user_id: "pending" }],
    academy_roster_entries: options.suspended ? [{ academy_id: "club", player_id: "pending", status: "suspended" }] : [],
  }, { caller: "coach" });
  state.db.rpc = async (name: string, args: Row) => {
    state.rpcs.push({ name, args });
    return { data: name === "coach_transfer_player_group" ? "transfer" : name === "organization_actor_legal_ready" ? options.legal !== false : !args.p_player, error: null } as never;
  };
  const route = loadManagerModule("app/api/coach/players/[playerId]/transfer-group/route.ts", state.mocks);
  const call = (method: "GET" | "POST") => route[method](new Request("https://activitee.app/api/coach/players/pending/transfer-group?sourceGroupId=source", {
    method, headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify({ sourceGroupId: "source", destinationGroupId: "destination", futureEventsAction: "keep" }) } : {}),
  }), { params: Promise.resolve({ playerId: "pending" }) });
  return { ...state, call };
}

test("pending junior can load destinations and transfer with the coach's explicit permission", async () => {
  const f = fixture();
  const response = await f.call("GET");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).destinationGroups[0].id, "destination");
  assert.equal((await f.call("POST")).status, 200);
  assert.ok(!f.rpcs.some(row => row.args.p_player));
  assert.deepEqual(f.rpcs.find(row => row.name === "coach_transfer_player_group")?.args, {
    p_actor_user_id: "coach", p_player_user_id: "pending", p_source_group_id: "source", p_destination_group_id: "destination", p_future_events_action: "keep",
  });
});

for (const options of [{ permission: false }, { active: false }, { legal: false }, { roster: false }, { playerClub: "other" }, { suspended: true }]) {
  test(`transfer refuses an unauthorized context: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.ok((await f.call("GET")).status >= 400);
    assert.ok((await f.call("POST")).status >= 400);
    assert.ok(!f.rpcs.some(row => row.name === "coach_transfer_player_group"));
  });
}
