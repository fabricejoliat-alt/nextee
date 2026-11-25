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
function addVolumeReferences(tables: Record<string, Row[]>) {
  tables.training_volume_settings = [club, academy].map(organization_id => ({ organization_id, season_months: [9], offseason_months: [8] }));
  tables.training_volume_targets = [[club, 300], [academy, 600]].map(([organization_id, minutes]) => ({ organization_id, sort_order: 1, ftem_code: "T1", level_label: "QA", handicap_min: 0, handicap_max: 54, minutes_offseason: minutes, minutes_inseason: minutes }));
}

function setup(tables = fixture(), denied: string[] = [], path = routePath, maxRows?: number) {
  const fake = managerDatabase(tables, { maxRows });
  fake.db.rpc = async (_name: string, args: Row) => ({ data: !denied.includes(args.p_org), error: null }) as any;
  const reads: string[] = [];
  const from = fake.db.from.bind(fake.db);
  fake.db.from = (table: string) => { reads.push(table); return from(table); };
  const route = loadManagerModule(path, {
    ...fake.mocks,
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

test("manager weekly chart and FTEM totals match Player for single and combined structures", async () => {
  const tables = fixture(); addVolumeReferences(tables);
  const h = setup(tables);
  for (const [scope, reference, total, rate] of [[club, 300, 60, 4], [academy, 600, 90, 3], ["all", 600, 150, 5]] as const) {
    const { response, body } = await h.get(`scope=${scope}&include_personal=false`);
    assert.equal(response.status, 200);
    assert.deepEqual(body.training.weekly.map((row: Row) => row.objective), Array(5).fill(reference));
    assert.equal(body.overview.training.objectiveMinutes, reference * 5);
    assert.equal(body.overview.training.minutes, total);
    assert.equal(body.overview.training.objectiveRate, rate);
    assert.equal(body.scope.objectiveMode, scope === "all" ? "maximum" : "organization");
  }
});

test("manager scorecards follow the authorized club, academy, personal and date scope", async () => {
  const tables = fixture();
  tables.golf_rounds = [
    { id: "club-round", club_id: club }, { id: "academy-round", club_id: academy },
    { id: "personal-round", club_id: null }, { id: "foreign-round", club_id: other },
    { id: "previous-round", club_id: club, start_at: "2026-08-20T10:00:00Z" },
  ].map(row => ({ user_id: "player", start_at: "2026-09-03T10:00:00Z", course_name: row.id, competition_name: "Junior Trophy", tee_name: "Yellow", round_type: "competition", score_entry_mode: "hole_by_hole", total_score: 72, ...row }));
  tables.golf_round_holes = tables.golf_rounds.flatMap(round => Array.from({ length: 18 }, (_, index) => ({ round_id: round.id, hole_no: index + 1, par: 4, score: 4, putts: 2, fairway_hit: true })));
  const h = setup(tables);
  for (const [scope, personal, expected] of [
    [club, false, ["club-round"]], [academy, false, ["academy-round"]],
    ["all", false, ["club-round", "academy-round"]], ["all", true, ["club-round", "academy-round", "personal-round"]],
  ] as const) {
    const { response, body } = await h.get(`scope=${scope}&include_personal=${personal}`);
    assert.equal(response.status, 200);
    assert.deepEqual(body.play.rounds.map((round: Row) => round.id), expected);
    assert.deepEqual([...new Set(body.play.scorecardHoles.map((hole: Row) => hole.round_id))], expected);
    assert.equal(body.play.scorecardHoles.length, expected.length * 18);
    assert.equal(body.play.rounds[0].competition_name, "Junior Trophy");
    assert.equal(body.play.scorecardHoles[0].putts, 2);
  }
});

test("manager scorecards paginate all holes instead of truncating at the database row limit", async () => {
  const tables = fixture();
  tables.golf_rounds = Array.from({ length: 70 }, (_, i) => ({ id: `round-${i}`, user_id: "player", club_id: club, start_at: "2026-09-03T10:00:00Z", round_type: "training" }));
  tables.golf_round_holes = tables.golf_rounds.flatMap(round => Array.from({ length: 18 }, (_, index) => ({ round_id: round.id, hole_no: index + 1, par: 4, score: 4 })));
  const { response, body } = await setup(tables, [], routePath, 1000).get("include_personal=false");
  assert.equal(response.status, 200);
  assert.equal(body.play.rounds.length, 70);
  assert.equal(body.play.scorecardHoles.length, 1260);
  assert.equal(body.play.completedRounds, 70);
});

test("inactive memberships and ended academy rosters are excluded before reading sports data", async () => {
  for (const kind of ["membership", "ended", "organization"]) {
    const tables = fixture();
    if (kind === "membership") tables.organization_members[1].is_active = false;
    if (kind === "ended") tables.academy_roster_entries[0].status = "ended";
    if (kind === "organization") tables.organizations[1].is_active = false;
    const h = setup(tables);
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

test("a manager can read every retained club player's statistics without Player onboarding or a mirrored membership", async () => {
  for (const kind of ["pending", "missing-mirror", "inactive-player"]) {
    const tables = fixture();
    tables.club_members[1].player_consent_status = "pending";
    if (kind === "missing-mirror") tables.organization_members = tables.organization_members.filter(row => row.organization_id !== club);
    if (kind === "inactive-player") tables.club_members[1].is_active = false;
    const h = setup(tables, [club, academy]);
    const { response, body } = await h.get("scope=current");
    assert.equal(response.status, 200, kind);
    assert.equal(body.overview.training.minutes, 90, kind);
    assert.deepEqual(body.scope.organizations.map((row: Row) => row.id), [club, academy]);
    assert.ok(!h.rpcs.some(row => row.name === "organization_player_authorized" && row.args.p_org === club));
    assert.equal((await h.get(`scope=${academy}`)).response.status, 200);
  }
});

test("Evan's recorded academy remains visible for manager statistics while consent and roster onboarding are pending", async () => {
  const tables = fixture(); addVolumeReferences(tables);
  tables.profiles[0].first_name = "Evan"; tables.profiles[0].last_name = "Bidal";
  tables.organizations[0].name = "Sion"; tables.organizations[1].name = "Cadre valaisan";
  tables.academy_roster_entries[0].status = "pending";
  for (const member of tables.organization_members) member.player_consent_status = "pending";
  const h = setup(tables, [club, academy]);
  const own = await h.get("include_personal=false");
  assert.equal(own.response.status, 200);
  assert.deepEqual(own.body.scope.organizations.map((org: Row) => org.name), ["Sion", "Cadre valaisan"]);
  const academyStats = await h.get(`scope=${academy}&include_personal=false`);
  assert.equal(academyStats.response.status, 200);
  assert.equal(academyStats.body.overview.training.minutes, 90);
  const combined = await h.get("scope=all&include_personal=false");
  assert.equal(combined.response.status, 200);
  assert.equal(combined.body.overview.training.minutes, 150);
  assert.equal(combined.body.overview.training.objectiveMinutes, 3000);
  assert.doesNotMatch(JSON.stringify(academyStats.body), /PRIVATE|foreign-event/);
  assert.equal(h.rpcs.length, 0);
  assert.equal(h.writes.length, 0);
});

test("legal updates suspending an academy roster do not hide an active affiliation's manager statistics", async () => {
  const tables = fixture(); tables.academy_roster_entries[0].status = "suspended";
  const h = setup(tables, [club, academy]);
  const academyStats = await h.get(`scope=${academy}&include_personal=false`);
  assert.equal(academyStats.response.status, 200);
  assert.equal(academyStats.body.overview.training.minutes, 90);
  const combined = await h.get("scope=all&include_personal=false");
  assert.equal(combined.response.status, 200);
  assert.equal(combined.body.overview.training.minutes, 150);
  assert.doesNotMatch(JSON.stringify(academyStats.body), /PRIVATE|foreign-event/);
  assert.equal(h.writes.length, 0);
});

test("retained inactive players remain in the manager team statistics and the inactive filter", async () => {
  const tables = fixture(); tables.club_members[1].is_active = false; tables.organization_members = [];
  const h = setup(tables, [club], "app/api/manager/clubs/[clubId]/performance/juniors/route.ts");
  const { response, body } = await h.get("status=inactive&include_personal=false");
  assert.equal(response.status, 200);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].id, "player");
  assert.equal(body.rows[0].active, false);
  assert.equal(body.rows[0].trainingMinutes, 60);
});

test("a missing player membership or an inactive manager cannot read junior statistics", async () => {
  for (const kind of ["missing-player", "inactive-manager"]) {
    const tables = fixture();
    if (kind === "missing-player") tables.club_members.pop();
    else tables.club_members[0].is_active = false;
    const h = setup(tables);
    assert.equal((await h.get()).response.status, kind === "missing-player" ? 404 : 403);
    assert.ok(!h.reads.includes("training_sessions"));
  }
});

test("legacy active academy affiliations without a roster entry remain usable", async () => {
  const tables = fixture(); tables.academy_roster_entries = [];
  const { response, body } = await setup(tables).get(`scope=${academy}&include_personal=false`);
  assert.equal(response.status, 200);
  assert.equal(body.overview.training.minutes, 90);
});

test("the team dashboard keeps the manager's juniors and scopes each junior independently", async () => {
  const tables = fixture(); addVolumeReferences(tables);
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
  assert.equal(peer.objectiveRate, 0.7);
  assert.equal(combined.body.rows.find((row: Row) => row.id === "player").objectiveRate, 5);
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
