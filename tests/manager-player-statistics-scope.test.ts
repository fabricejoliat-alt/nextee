/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated database fixtures, no real junior data. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, flush } from "./helpers/coachComponentHarness.ts";

const club = "11111111-1111-4111-8111-111111111111";
const academy = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const routePath = "app/api/manager/clubs/[clubId]/players/[playerId]/statistics/route.ts";
function fixture() {
  const sessions = [
    { id: "club-training", club_id: club, club_event_id: "club-event", total_minutes: 60 },
    { id: "club-duplicate", club_id: club, club_event_id: "club-event", total_minutes: 60 },
    { id: "academy-training", club_id: academy, club_event_id: "academy-event", total_minutes: 90 },
    { id: "personal-training", club_id: null, club_event_id: null, total_minutes: 30 },
    { id: "foreign-training", club_id: other, club_event_id: "foreign-event", total_minutes: 900 },
    { id: "misattributed-personal", club_id: null, club_event_id: "foreign-event", total_minutes: 999 },
  ];
  const tables: Record<string, Row[]> = {
    club_members: [
      { id: "manager-member", club_id: club, user_id: "manager", role: "manager", is_active: true },
      { id: "junior-member", club_id: club, user_id: "player", role: "player", is_active: true, is_performance: true },
    ],
    profiles: [{ id: "player", first_name: "Junior", last_name: "QA", handicap: 18 }],
    organizations: [
      { id: club, name: "Club QA", org_type: "club", is_active: true },
      { id: academy, name: "Academy QA", org_type: "academy", is_active: true },
      { id: other, name: "Unrelated QA", org_type: "academy", is_active: true },
    ],
    organization_members: [club, academy].map(organization_id => ({ organization_id, user_id: "player", role: "player", is_active: true })),
    academy_roster_entries: [{ academy_id: academy, player_id: "player", status: "active" }],
    training_sessions: sessions.map(row => ({ ...row, user_id: "player", session_type: row.club_id ? "club" : "individual", start_at: "2026-09-03T10:00:00Z", motivation: 3, difficulty: 2, satisfaction: 4 })),
    training_session_items: sessions.map(row => ({ session_id: row.id, category: "putting", minutes: row.total_minutes })),
    club_events: [
      { id: "club-event", club_id: club }, { id: "academy-event", club_id: academy }, { id: "foreign-event", club_id: other },
    ].map(row => ({ ...row, title: row.id, starts_at: "2026-09-03T10:00:00Z", status: "published", event_type: "training", requires_evaluation: true })),
    club_event_attendees: [
      { event_id: "club-event", status: "present" }, { event_id: "academy-event", status: "absent" }, { event_id: "foreign-event", status: "present" },
    ].map(row => ({ ...row, player_id: "player" })),
    club_event_coach_feedback: ["club-event", "academy-event", "foreign-event"].map(event_id => ({ event_id, player_id: "player", engagement: 4, attitude: 3, performance: 5, player_note: `${event_id}: PRIVATE`, visible_to_player: false })),
    club_event_evaluation_criteria: [
      { id: "numeric", snapshot_response_format: "scale_1_6" }, { id: "text", snapshot_response_format: "short_text" },
    ].map(row => ({ ...row, event_id: "academy-event", club_id: academy, is_enabled: true })),
    club_event_evaluation_responses: [
      { event_criterion_id: "numeric", value_json: { value: 4, private_note: "PRIVATE ACADEMY TEXT" } },
      { event_criterion_id: "text", value_json: "PRIVATE ACADEMY FREE TEXT" },
    ].map(row => ({ ...row, event_id: "academy-event", club_id: academy, player_id: "player", respondent_role: "coach" })),
  };
  return tables;
}
function setup(tables = fixture(), denied: string[] = [], path = routePath) {
  const fake = managerDatabase(tables);
  fake.db.rpc = async (_name: string, args: Row) => ({ data: !denied.includes(args.p_org), error: null }) as any;
  const reads: string[] = [];
  const from = fake.db.from.bind(fake.db);
  fake.db.from = (table: string) => { reads.push(table); return from(table); };
  const route = loadManagerModule(path, {
    ...fake.mocks,
    "@/lib/server/personalHistoryAccess": {
      canReadPlayerHistory: async (_db: unknown, actorId: string, _player: string, organizationId: string) => actorId === "manager" && organizationId === club,
      readablePlayerHistoryIds: async (_db: unknown, _actor: string, ids: string[]) => ids,
    },
  });
  const get = async (params = "") => {
    const req = new Request(`https://test.invalid/stats?from=2026-09-01&to=2026-09-30&comparison=none&${params}`, { headers: { Authorization: "Bearer test" } });
    const response = await route.GET(Object.assign(req, { nextUrl: new URL(req.url) }), { params: Promise.resolve({ clubId: club, playerId: "player" }) });
    return { response, body: await response.json() };
  };
  return { ...fake, reads, get };
}

test("a manager of the club can select its junior's academy statistics without being an academy manager", async () => {
  const { body, response } = await setup().get(`scope=${academy}&include_personal=false`);
  assert.equal(response.status, 200);
  assert.equal(body.overview.training.minutes, 90);
  assert.equal(body.overview.training.sessions, 1);
  assert.equal(body.attendance.rate, 0);
  assert.equal(body.scope.objectiveOrganization.id, academy);
  assert.deepEqual(body.scope.organizations.map((row: Row) => row.id), [club, academy]);
  assert.equal(body.evaluations.coach[0].player_note, null);
  assert.equal(body.evaluations.custom.length, 1);
  assert.equal(body.evaluations.custom[0].value_json, 4);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|foreign-event|Unrelated QA/);
});

test("club, academy and combined views recalculate attendance and count personal training only once", async () => {
  const h = setup();
  const own = await h.get("include_personal=false");
  const combined = await h.get("scope=all&include_personal=false");
  const personal = await h.get("scope=all");
  assert.equal(own.body.overview.training.minutes, 60);
  assert.equal(own.body.attendance.rate, 100);
  assert.equal(combined.body.overview.training.minutes, 150);
  assert.equal(combined.body.training.weekly.reduce((sum: number, row: Row) => sum + row.total, 0), 150);
  assert.equal(combined.body.attendance.rate, 50);
  assert.equal(combined.body.overview.training.sessions, 2);
  assert.equal(personal.body.overview.training.minutes, 180);
  assert.equal(personal.body.overview.training.sessions, 3);
  assert.equal(personal.body.training.byCategory[0].minutes, 180);
  assert.equal(personal.body.scope.objectiveOrganization.id, club);
  assert.equal(h.writes.length, 0);
});

test("inactive memberships, revoked authorization and suspended academy rosters are excluded before reading sports data", async () => {
  for (const kind of ["membership", "authorization", "roster", "organization"]) {
    const tables = fixture();
    if (kind === "membership") tables.organization_members[1].is_active = false;
    if (kind === "roster") tables.academy_roster_entries[0].status = "suspended";
    if (kind === "organization") tables.organizations[1].is_active = false;
    const h = setup(tables, kind === "authorization" ? [academy] : []);
    const { response, body } = await h.get(`scope=${academy}`);
    assert.equal(response.status, 403, kind);
    assert.equal(body.error, "manager.junior.stats.scopeForbidden");
    assert.ok(!h.reads.includes("training_sessions"), kind);
    const combined = await h.get("scope=all&include_personal=false");
    assert.equal(combined.body.overview.training.minutes, 60, kind);
  }
});

test("an arbitrary structure or a missing current manager membership cannot open another structure's data", async () => {
  const h = setup();
  assert.equal((await h.get(`scope=${other}`)).response.status, 403);
  assert.equal((await h.get("scope=all),club_id.not.is.null")).response.status, 403);
  const tables = fixture(); tables.club_members.shift();
  const denied = setup(tables);
  assert.equal((await denied.get("scope=all")).response.status, 403);
  assert.ok(!denied.reads.includes("training_sessions"));
});

test("legacy active academy affiliations without a roster entry remain usable", async () => {
  const tables = fixture(); tables.academy_roster_entries = [];
  const { response, body } = await setup(tables).get(`scope=${academy}&include_personal=false`);
  assert.equal(response.status, 200);
  assert.equal(body.overview.training.minutes, 90);
});

test("the team dashboard keeps the manager's juniors and scopes each junior independently", async () => {
  const tables = fixture();
  tables.club_members.push({ id: "peer-member", club_id: club, user_id: "peer", role: "player", is_active: true });
  tables.organization_members.push({ organization_id: club, user_id: "peer", role: "player", is_active: true });
  tables.profiles.push({ id: "peer", first_name: "Peer", last_name: "QA", handicap: 20 });
  for (const [club_id, total_minutes] of [[club, 10], [academy, 500]] as const) tables.training_sessions.push({
    id: `peer-${club_id}`, user_id: "peer", club_id, start_at: "2026-09-03T10:00:00Z", total_minutes,
  });
  tables.club_event_attendees.push({ player_id: "peer", event_id: "academy-event", status: "present" });
  const h = setup(tables, [], "app/api/manager/clubs/[clubId]/performance/juniors/route.ts");
  const combined = await h.get("scope=all&include_personal=false");
  assert.equal(combined.response.status, 200);
  assert.equal(combined.body.rows.length, 2);
  assert.equal(combined.body.training.totalMinutes, 160);
  assert.equal(combined.body.rows.find((row: Row) => row.id === "player").trainingMinutes, 150);
  const peer = combined.body.rows.find((row: Row) => row.id === "peer");
  assert.equal(peer.trainingMinutes, 10);
  assert.equal(peer.attendance.invited, 0);
  assert.equal(peer.evaluationsExpected, 0);
  const academyOnly = await h.get(`scope=${academy}&include_personal=false`);
  assert.equal(academyOnly.body.rows.length, 1);
  assert.equal(academyOnly.body.training.totalMinutes, 90);
  assert.equal(academyOnly.body.overview.attendanceRate, 0);
  assert.doesNotMatch(JSON.stringify(academyOnly.body), /PRIVATE|foreign-event|Unrelated QA/);
  assert.equal((await h.get(`scope=${other}`)).response.status, 403);
  assert.equal(h.writes.length, 0);
});

test("changing structure hides old statistics immediately and a late response cannot replace the selected view", async () => {
  const requests: Array<{ scope: string; complete: (response: Response) => void }> = [];
  const stats = (selected: string) => ({ tag: selected, scope: { selected, organizations: [
    { id: club, name: "Club QA", org_type: "club" }, { id: academy, name: "Academy QA", org_type: "academy" },
  ] } });
  const h = coachComponentHarness("components/manager/ManagerPlayerStatistics.tsx", {
    props: { clubId: club, playerId: "player", seasonRange: { from: "2026-01-01", to: "2026-12-31" } },
    fetch: async (url) => {
      const selected = new URL(String(url), "https://test.invalid").searchParams.get("scope")!;
      if (selected === "current") return Response.json(stats(selected));
      return new Promise<Response>(complete => requests.push({ scope: selected, complete }));
    },
  });
  const settle = async () => { let tree = h.render(); for (let i = 0; i < 4; i++) { await flush(); tree = h.render(); } return tree; };
  try {
    let tree = await settle();
    assert.ok(elements(tree).some(node => node.props.stats?.tag === "current"));
    const select = () => elements(tree).find(node => node.type === "select" && [club, academy, "all"].includes(node.props.value))!;
    select().props.onChange({ target: { value: academy } });
    tree = h.render();
    assert.ok(!elements(tree).some(node => node.props.stats));
    tree = await settle();
    select().props.onChange({ target: { value: "all" } });
    tree = await settle();
    requests.find(request => request.scope === "all")!.complete(Response.json(stats("all")));
    tree = await settle();
    requests.find(request => request.scope === academy)!.complete(Response.json(stats(academy)));
    tree = await settle();
    assert.ok(elements(tree).some(node => node.props.stats?.tag === "all"));
    assert.ok(!elements(tree).some(node => node.props.stats?.tag === academy));
  } finally { h.cleanup(); }
});
