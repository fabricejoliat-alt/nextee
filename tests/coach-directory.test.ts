import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";

const org = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
function fixture(options: { transfer?: boolean; membership?: boolean; legal?: boolean; access?: boolean; rpcError?: boolean; failureTable?: string; extraGroups?: number } = {}) {
  const group = (id: string, club_id = org, head: string | null = "coach", is_active = true, name = id) => ({ id, club_id, head_coach_user_id: head, is_active, name });
  const tables: Record<string, Row[]> = {
    club_members: [
      { club_id: org, user_id: "coach", role: "coach", is_active: options.membership !== false, can_transfer_players_between_club_groups: options.transfer ?? false },
      { club_id: other, user_id: "coach", role: "coach", is_active: false },
      ...["allowed", "denied", "mobile", "outside"].map(user_id => ({ club_id: user_id === "outside" ? other : org, user_id, role: "player", is_active: true })),
    ],
    organizations: [{ id: org, name: "Sion" }, { id: other, name: "Outside" }],
    coach_groups: [group("head"), group("linked", org, "another"), group("unassigned", org, "another"), group("inactive", org, "coach", false),
      group("special", org, "coach", true, "__EVENT_SPECIFIQUE__123"), group("archive", org, "coach", true, "__ARCHIVE_DELETED__123"),
      group("outside", other), ...Array.from({ length: options.extraGroups ?? 0 }, (_, n) => group(`extra-${n}`))],
    coach_group_coaches: [{ group_id: "head", coach_user_id: "coach", is_head: true }, { group_id: "linked", coach_user_id: "coach", is_head: false },
      { group_id: "outside", coach_user_id: "coach", is_head: true }],
    coach_group_players: [{ group_id: "head", player_user_id: "allowed" }, { group_id: "head", player_user_id: "denied" },
      { group_id: "linked", player_user_id: "allowed" }, { group_id: "unassigned", player_user_id: "mobile" }, { group_id: "outside", player_user_id: "outside" }],
    coach_group_categories: [{ group_id: "head", category: "U14" }, { group_id: "outside", category: "Private" }],
    profiles: ["allowed", "denied", "mobile", "outside"].map(id => ({ id, first_name: id, last_name: "Junior", avatar_url: null, handicap: 10, sex: null })),
  };
  const state = managerDatabase(tables, { failureTable: options.failureTable });
  state.db.rpc = async (name: string, args: Row) => {
    state.rpcs.push({ name, args });
    const allowed = name === "organization_actor_legal_ready" ? options.legal !== false
      : options.access !== false && args.p_org === org && (!args.p_player || args.p_player === "allowed" || (options.transfer && args.p_player === "mobile"));
    return { data: allowed, error: options.rpcError ? { message: "sensitive SQL diagnostic" } : null } as never;
  };
  const reads: string[] = [];
  const from = state.db.from.bind(state.db);
  state.db.from = (table: string) => { reads.push(table); return from(table); };
  const { loadCoachDirectory } = loadManagerModule("lib/server/coachDirectory.ts", {});
  return { ...state, reads, tables, load: (view: "groups" | "players", scope: string | null = null) => loadCoachDirectory(state.db, "coach", view, scope) };
}

test("directory returns active assigned groups, with authorized counts and no other organization", async () => {
  const f = fixture(); const result = await f.load("groups");
  assert.deepEqual(result.groups.map((g: Row) => g.id), ["head", "linked"]);
  assert.deepEqual(result.groups.map((g: Row) => g.playerCount), [2, 1]);
  assert.deepEqual(result.groups[0].categories, ["U14"]);
  assert.equal(result.groups[0].isHead, true);
  assert.equal(result.groups[1].isAssigned, true);
  assert.equal(result.groups[1].isHead, false);
  assert.deepEqual(result.players, []);
  assert.equal(f.reads.includes("profiles"), false);
  assert.equal(f.writes.length, 0);
});

test("junior projection deduplicates assigned juniors and only returns allowed memberships", async () => {
  const f = fixture(); const result = await f.load("players");
  assert.deepEqual(result.players.map((p: Row) => p.id), ["allowed"]);
  assert.deepEqual(result.players[0].club_ids, [org]);
  assert.deepEqual(result.players[0].club_names, ["Sion"]);
  assert.equal(f.reads.includes("coach_group_categories"), false);
  assert.ok(f.rpcs.some(call => call.name === "organization_actor_access" && call.args.p_player === "denied"));
});

test("transfer permission includes other operational groups but still checks each junior", async () => {
  const f = fixture({ transfer: true });
  const groups = await f.load("groups");
  assert.deepEqual(groups.groups.map((g: Row) => g.id), ["head", "linked", "unassigned"]);
  assert.equal(groups.groups[2].isAssigned, false);
  assert.equal(groups.groups[2].playerCount, 1);
  assert.deepEqual((await f.load("players")).players.map((p: Row) => p.id), ["allowed", "mobile"]);
});

for (const options of [{ membership: false }, { legal: false }, { access: false }]) {
  test(`inactive, unauthorized or legally blocked coach receives no directory: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.deepEqual(await f.load("groups"), { groups: [], players: [], clubs: [] });
    assert.deepEqual(f.reads, ["club_members"]);
  });
}

test("requesting a different organization cannot reuse assignments or transfer permissions", async () => {
  const f = fixture({ transfer: true });
  assert.deepEqual(await f.load("players", other), { groups: [], players: [], clubs: [] });
  assert.deepEqual(f.reads, ["club_members"]);
});

test("table reads remain bounded as group count grows", async () => {
  const f = fixture({ extraGroups: 100 }); const result = await f.load("groups");
  assert.equal(result.groups.length, 102);
  for (const table of ["coach_groups", "coach_group_coaches", "coach_group_players", "coach_group_categories"]) {
    assert.equal(f.reads.filter(t => t === table).length, 1, table);
  }
});

test("failed access checks and data reads fail closed", async () => {
  await assert.rejects(fixture({ rpcError: true }).load("groups"));
  await assert.rejects(fixture({ failureTable: "coach_group_players" }).load("players"));
});

test("directory endpoint verifies bearer identity, validates scope and never caches data", async () => {
  let reads = 0;
  const { GET } = loadManagerModule("app/api/coach/directory/route.ts", {
    "@/lib/server/legalAccess": { legalDb: () => ({}), legalActor: async () => ({ id: "verified-coach" }), legalNoStore: { "Cache-Control": "private, no-store" } },
    "@/lib/server/organizationAccess": { uuidPattern: /^[0-9a-f-]{36}$/i },
    "@/lib/server/coachDirectory": { loadCoachDirectory: async (_db: unknown, actor: string, view: string, scope: string) => {
      reads++; assert.equal(actor, "verified-coach"); assert.equal(view, "groups"); assert.equal(scope, org); return { groups: [] };
    } },
  });
  const request = (query: string, token = true) => {
    const req = new Request(`https://activitee.app/api/coach/directory?${query}`, { headers: token ? { Authorization: "Bearer test" } : {} });
    return Object.assign(req, { nextUrl: new URL(req.url) });
  };
  assert.equal((await GET(request("view=groups", false))).status, 401);
  assert.equal((await GET(request("view=secret"))).status, 400);
  assert.equal((await GET(request("view=groups&organization_id=invalid"))).status, 400);
  const response = await GET(request(`view=groups&organization_id=${org}`));
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.match(response.headers.get("server-timing"), /directory;dur=/);
});

test("directory API rejects invalid sessions and masks dependent failures", async () => {
  for (const authenticated of [false, true]) {
    let reads = 0;
    const { GET } = loadManagerModule("app/api/coach/directory/route.ts", {
      "@/lib/server/legalAccess": { legalDb: () => ({}), legalActor: async () => authenticated ? { id: "coach" } : null, legalNoStore: { "Cache-Control": "private, no-store" } },
      "@/lib/server/organizationAccess": { uuidPattern: /^[0-9a-f-]{36}$/i },
      "@/lib/server/coachDirectory": { loadCoachDirectory: async () => { reads++; throw new Error("private SQL diagnostic"); } },
    });
    const req = new Request("https://activitee.app/api/coach/directory?view=players", { headers: { Authorization: "Bearer invalid" } });
    const response = await GET(Object.assign(req, { nextUrl: new URL(req.url) }));
    assert.equal(response.status, authenticated ? 500 : 401);
    assert.equal(reads, authenticated ? 1 : 0);
    assert.ok(!(await response.text()).includes("private SQL"));
  }
});
