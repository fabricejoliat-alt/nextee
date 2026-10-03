import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeCoachMemberships, canCoachAccessEvent, requireCoachEventPlayer, resolveCoachAssignments } from "../lib/coachAccess.ts";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
function loadModule<T>(path: string, mocks: Record<string, unknown> = {}): T {
  const source = readFileSync(resolve(root, path), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", "process", code)((id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("@/") || id.startsWith(".")) {
      const base = id.startsWith("@/") ? id.slice(2) : resolve(path, "..", id);
      return loadModule(existsSync(resolve(root, base)) ? base : base + ".ts", mocks);
    }
    return require(id);
  }, compiledModule, compiledModule.exports, mocks.__process ?? process);
  return compiledModule.exports as T;
}

type Row = Record<string, unknown>;
function fakeDatabase(tables: Record<string, Row[]>, failureTable?: string) {
  const reads: string[] = [];
  const writes: string[] = [];
  const db = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let single = false;
      let writing = false;
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        neq(key: string, value: unknown) { rows = rows.filter((row) => row[key] !== value); return query; },
        in(key: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        lt(key: string, value: string) { rows = rows.filter((row) => String(row[key]) < value); return query; },
        gte(key: string, value: string) { rows = rows.filter((row) => String(row[key]) >= value); return query; },
        range(from: number, to: number) { rows = rows.slice(from, to + 1); return query; },
        order() { return query; },
        limit(count: number) { rows = rows.slice(0, count); return query; },
        maybeSingle() { single = true; return query; },
        insert() { writing = true; return query; },
        update() { writing = true; return query; },
        delete() { writing = true; return query; },
        upsert() { writing = true; return query; },
        then(yes: (value: unknown) => unknown, no?: (cause: unknown) => unknown) {
          (writing ? writes : reads).push(table);
          return Promise.resolve({ data: table === failureTable ? null : single ? rows[0] ?? null : rows,
            error: table === failureTable ? { message: "database unavailable" } : null }).then(yes, no);
        },
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, reads, writes };
}

function fixture() {
  return {
    club_members: [
      { user_id: "coach", club_id: "A", role: "coach", is_active: true },
      { user_id: "coach", club_id: "B", role: "coach", is_active: true },
      { user_id: "player", club_id: "A", role: "player", is_active: true },
      { user_id: "player", club_id: "B", role: "player", is_active: true },
    ],
    coach_groups: [
      { id: "group-A", club_id: "A", head_coach_user_id: "head", is_active: true },
      { id: "group-B", club_id: "B", head_coach_user_id: "other", is_active: true },
    ],
    coach_group_coaches: [{ group_id: "group-A", coach_user_id: "coach" }],
    coach_group_players: [{ group_id: "group-A", player_user_id: "player" }, { group_id: "group-B", player_user_id: "player" }],
    club_events: [
      { id: "event-A", group_id: "group-A", club_id: "A", event_type: "training", starts_at: "2026-01-01T10:00:00Z" },
      { id: "event-B", group_id: "group-B", club_id: "B", event_type: "training", starts_at: "2026-01-01T10:00:00Z" },
    ],
    club_event_coaches: [] as Row[],
    club_event_attendees: [{ event_id: "event-A", player_id: "player" }],
  };
}

function apiMocks(db: SupabaseClient) {
  return {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/messages/_lib": { requireCaller: async () => ({ supabaseAdmin: db, callerId: "coach" }) },
    "@supabase/supabase-js": { createClient: () => db },
    __process: { env: { NEXT_PUBLIC_SUPABASE_URL: "http://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only" } },
    "@/lib/playerDocumentUpload": {},
    "@/lib/playerDocumentPolicy": {},
    "@/lib/playerDocumentStorage": { signPlayerDocumentRows: async (_db: unknown, rows: unknown) => rows },
  };
}
const request = (path: string) => new Request(`http://localhost${path}`, { headers: { Authorization: "Bearer test-only" } });

test("Coach camps select the stored photo only within the caller's authorized clubs", async () => {
  const { db, reads, writes } = fakeDatabase({
    club_camps: [
      { id: "camp", club_id: "A", title: "Stage", image_url: "/camp-photo.jpg", head_coach_user_id: null },
      { id: "outside", club_id: "B", title: "Outside", image_url: "/private-photo.jpg", head_coach_user_id: null },
    ], clubs: [{ id: "A", name: "Club A" }],
  });
  let selectedPhoto = false;
  const from = db.from.bind(db);
  const scopedDb = { from(table: string) {
    const query = from(table);
    if (table === "club_camps") {
      const select = query.select.bind(query);
      query.select = ((columns: string) => {
        selectedPhoto = columns.split(",").includes("image_url");
        return select(columns);
      }) as typeof query.select;
    }
    return query;
  } };
  const route = loadModule<{ GET: (req: Request) => Promise<Response> }>("app/api/coach/camps/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/camps/_lib": {
      createAdminClient: () => scopedDb, getCaller: async () => ({ userId: "coach" }),
      resolveCoachClubIds: async () => ({ clubIds: ["A"] }),
      uniq: (values: unknown[]) => [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))],
    },
  });
  assert.equal((await route.GET(new Request("http://localhost/api/coach/camps"))).status, 401);
  assert.deepEqual(reads, []);
  const response = await route.GET(request("/api/coach/camps"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(selectedPhoto, true);
  assert.equal(payload.coachClubCount, 1);
  assert.deepEqual(payload.camps.map((row: Row) => [row.id, row.image_url]), [["camp", "/camp-photo.jpg"]]);
  assert.deepEqual(writes, []);
});

type DeletePlanning = { deleteCoachPlanning: (req: Request, target: { eventId: string } | { seriesId: string }) => Promise<Response> };
const deleteId = "00000000-0000-4000-8000-000000099001";
test("planning deletion delegates one authenticated transaction and returns no private recipients", async () => {
  const calls: unknown[] = [], notices: unknown[][] = [];
  const db = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { error: null, data: {
    ok: true, deleted_events: 2, deleted_series_id: deleteId, events: [{ id: "event", starts_at: "2090-01-01T10:00:00Z" }], recipient_ids: ["private-recipient"],
  } }; }, from() { throw new Error("Unexpected destructive fallback"); } };
  const route = loadModule<DeletePlanning>("lib/server/coachPlanningDeletion.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/messages/_lib": { requireCaller: async () => ({ supabaseAdmin: db, callerId: "verified-actor" }) },
    "@/lib/server/coachPlanningNotifications": { notifyPlanningDeletion: async (...args: unknown[]) => { notices.push(args); } },
  });
  const response = await route.deleteCoachPlanning(request("/series"), { seriesId: deleteId });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.ok, true);
  assert.equal(result.notification_warning, false); assert.equal(result.recipient_ids, undefined); assert.equal(result.events, undefined);
  assert.deepEqual(calls, [{ name: "delete_coach_planning_v1", args: { p_actor_id: "verified-actor", p_event_id: null, p_series_id: deleteId, p_occurrence_confirmed: false } }]);
  assert.equal(notices.length, 1); assert.equal(notices[0][4], 2);
});

test("planning deletion fails closed on permission or migration failure and never exposes database detail", async () => {
  for (const [message, status] of [["forbidden", 403], ["event_not_found", 404], ["private schema detail", 503]] as const) {
    let notices = 0;
    const route = loadModule<DeletePlanning>("lib/server/coachPlanningDeletion.ts", {
      "next/server": { NextResponse: { json: Response.json } },
      "@/app/api/messages/_lib": { requireCaller: async () => ({ callerId: "verified", supabaseAdmin: { rpc: async () => ({ data: null, error: { message } }) } }) },
      "@/lib/server/coachPlanningNotifications": { notifyPlanningDeletion: async () => { notices++; } },
    });
    const response = await route.deleteCoachPlanning(request("/event?scope=occurrence"), { eventId: deleteId });
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /private schema detail/); assert.equal(notices, 0);
  }
});

test("notification failure cannot turn committed deletion into a retryable write and invalid auth cannot call the transaction", async () => {
  let writes = 0;
  const route = loadModule<DeletePlanning>("lib/server/coachPlanningDeletion.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/messages/_lib": { requireCaller: async (token: string) => {
      if (token === "bad") throw new Error("private auth failure");
      return { callerId: "verified", supabaseAdmin: { rpc: async () => { writes++; return { error: null, data: { ok: true, deleted_events: 1,
        events: [{ id: "event" }], recipient_ids: ["player"] } }; } } };
    } },
    "@/lib/server/coachPlanningNotifications": { notifyPlanningDeletion: async () => { throw new Error("private notification failure"); } },
  });
  const response = await route.deleteCoachPlanning(request("/event?scope=occurrence"), { eventId: deleteId });
  assert.equal(response.status, 200); assert.equal((await response.json()).notification_warning, true);
  assert.equal((await route.deleteCoachPlanning(new Request("http://localhost/event"), { eventId: deleteId })).status, 401);
  assert.equal((await route.deleteCoachPlanning(new Request("http://localhost/event", { headers: { authorization: "Bearer bad" } }), { eventId: deleteId })).status, 401);
  assert.equal((await route.deleteCoachPlanning(request("/event"), { eventId: "not-an-id" })).status, 400);
  assert.equal(writes, 1);
});

function planningFixture(): Record<string, Row[]> {
  const data: Record<string, Row[]> = fixture();
  data.coach_groups[0].name = "Groupe A";
  data.club_members[0].can_manage_assigned_group_planning = true;
  data.clubs = [{ id: "A", name: "Club A" }, { id: "B", name: "Club B" }];
  data.profiles = [{ id: "player", first_name: "Junior", last_name: "A", avatar_url: null, private_note: "never expose" },
    { id: "coach", first_name: "Coach", last_name: "A", avatar_url: null }];
  data.club_events[0] = { ...data.club_events[0], status: "scheduled", requires_evaluation: true,
    ends_at: "2026-01-01T11:00:00Z", duration_minutes: 60, series_id: "series", title: "Entraînement A", coach_note: "never expose" };
  data.club_event_attendees = [{ event_id: "event-A", player_id: "player", status: "expected", coach_recorded_status: "present" }];
  data.club_event_coaches = [{ event_id: "event-A", coach_id: "coach" }];
  data.club_event_coach_feedback = [{ event_id: "event-A", player_id: "player", coach_id: "colleague", engagement: 4, attitude: 4, performance: 4, private_note: "never expose" }];
  data.club_event_evaluation_criteria = [{ id: "criterion", event_id: "event-A", is_enabled: true,
    snapshot_respondent: "coach", snapshot_is_required: true, snapshot_response_format: "yes_no", snapshot_choices: [{ value: true }] }];
  data.club_event_evaluation_responses = [];
  return data;
}
type PlanningRoute = { GET: (req: Request, ctx: { params: Promise<{ groupId: string }> }) => Promise<Response> };
const planningContext = (groupId = "group-A") => ({ params: Promise.resolve({ groupId }) });
function planningRoute(data: Record<string, Row[]>, failureTable?: string) {
  const fake = fakeDatabase(data, failureTable);
  Object.assign(fake.db, { auth: { getUser: async () => ({ data: { user: { id: "coach" } }, error: null }) } });
  return { ...fake, route: loadModule<PlanningRoute>("app/api/coach/groups/[groupId]/planning/route.ts", apiMocks(fake.db)) };
}

test("planning uses shared guided completion and exposes no private feedback or answers", async () => {
  const data = planningFixture();
  for (const complete of [false, true]) {
    data.club_event_evaluation_responses = complete ? [{ event_id: "event-A", player_id: "player", event_criterion_id: "criterion", respondent_role: "coach", value_json: true }] : [];
    const { route, writes } = planningRoute(data);
    const response = await route.GET(request("/planning"), planningContext());
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(body.can_plan, true);
    assert.deepEqual(body.events.map((event: Row) => event.id), ["event-A"]);
    assert.equal(body.events[0].evaluation_complete, complete);
    assert.equal(body.events[0].attendees[0].coach_recorded_status, "present");
    assert.equal(body.events[0].attendees[0].is_player, true);
    assert.doesNotMatch(JSON.stringify(body), /never expose|private_note|coach_note|engagement|value_json|criterion/);
    assert.deepEqual(writes, []);
  }
});

test("planning refuses inactive, unrelated and non-staff users before loading event rosters", async () => {
  for (const mode of ["inactive", "unassigned", "player", "foreign-club"] as const) {
    const data = planningFixture();
    if (mode === "inactive") data.club_members[0].is_active = false;
    if (mode === "unassigned") data.coach_group_coaches = [];
    if (mode === "player") data.club_members[0].role = "player";
    const { route, reads, writes } = planningRoute(data);
    const response = await route.GET(request("/planning"), planningContext(mode === "foreign-club" ? "group-B" : "group-A"));
    assert.equal(response.status, 403, mode);
    assert.ok(!reads.includes("club_events"), mode);
    assert.ok(!reads.includes("profiles"), mode);
    assert.deepEqual(writes, []);
  }
});

test("planning separates read-only transfer access from assigned planning permission", async () => {
  for (const mode of ["assigned-readonly", "head", "manager", "transfer-readonly"] as const) {
    const data = planningFixture();
    if (mode === "assigned-readonly") data.club_members[0].can_manage_assigned_group_planning = false;
    if (mode === "head") { data.coach_group_coaches = []; data.coach_groups[0].head_coach_user_id = "coach"; }
    if (mode === "manager") { data.coach_group_coaches = []; data.club_members[0].role = "manager"; }
    if (mode === "transfer-readonly") { data.coach_group_coaches = []; data.club_members[0].can_transfer_players_between_club_groups = true; }
    const { route } = planningRoute(data);
    const response = await route.GET(request("/planning"), planningContext());
    assert.equal(response.status, 200, mode);
    assert.equal((await response.json()).can_plan, mode === "head" || mode === "manager", mode);
  }
});

test("planning fails closed on dependent reads without returning SQL details or partial counts", async () => {
  for (const table of ["coach_groups", "club_members", "club_events", "club_event_attendees", "club_event_coaches",
    "club_event_coach_feedback", "club_event_evaluation_criteria", "club_event_evaluation_responses", "profiles", "clubs"]) {
    const { route } = planningRoute(planningFixture(), table);
    const response = await route.GET(request("/planning"), planningContext());
    assert.equal(response.status, 500, table);
    assert.deepEqual(await response.json(), { code: "planning_load_failed" }, table);
  }
});

test("planning requires authentication and handles a missing group without writes", async () => {
  const { route, reads, writes } = planningRoute(planningFixture());
  assert.equal((await route.GET(new Request("http://localhost/planning"), planningContext())).status, 401);
  assert.deepEqual(reads, []);
  assert.equal((await route.GET(request("/planning"), planningContext("missing"))).status, 404);
  assert.deepEqual(writes, []);
});

test("planning paginates group events and attendee rosters beyond the database row limit", async () => {
  const data = planningFixture();
  data.club_events = Array.from({ length: 1001 }, (_, index) => ({ ...data.club_events[0], id: `event-${index}`, event_type: "session" }));
  data.club_event_attendees = Array.from({ length: 1001 }, (_, index) => ({ event_id: "event-1000", player_id: `player-${index}`, status: "expected", coach_recorded_status: null }));
  data.profiles = Array.from({ length: 1001 }, (_, index) => ({ id: `player-${index}`, first_name: `Junior ${index}`, last_name: null, avatar_url: null }));
  data.club_members.push(...data.profiles.map((person) => ({ club_id: "A", user_id: person.id, role: "player", is_active: true })));
  const { route, reads } = planningRoute(data);
  const response = await route.GET(request("/planning"), planningContext());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.events.length, 1001);
  assert.equal(body.events[1000].attendees.length, 1001);
  assert.equal(body.events[1000].attendees[1000].first_name, "Junior 1000");
  assert.equal(reads.filter((table) => table === "club_events").length, 3);
});

test("validation catalogue counts successes beyond page one and preserves player-by-player progression", async () => {
  const data: Record<string, Row[]> = fixture();
  data.validation_sections = [{ id: "section", slug: "putting", name: "Putting", sort_order: 1, is_active: true }];
  data.validation_exercises = [
    { id: "first", section_id: "section", name: "First", sequence_no: 1, is_active: true },
    { id: "second", section_id: "section", name: "Second", sequence_no: 2, is_active: true },
  ];
  data.player_validation_attempts = [
    ...Array.from({ length: 1000 }, (_, i) => ({ id: String(i), player_id: "player", exercise_id: "first", result: "success" })),
    { id: "last", player_id: "player", exercise_id: "second", result: "success" },
    { id: "foreign", player_id: "outside", exercise_id: "second", result: "success" },
  ];
  const { db, reads, writes } = fakeDatabase(data);
  Object.assign(db, { auth: { getUser: async () => ({ data: { user: { id: "coach" } }, error: null }) } });
  const route = loadModule<{ GET: (req: Request) => Promise<Response> }>("app/api/coach/validations/route.ts", apiMocks(db));
  const response = await route.GET(request("/api/coach/validations"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.player_count, 1); // The same player belongs to both authorized clubs.
  assert.deepEqual(body.sections[0].exercises.map((row: Row) => row.validated_player_count), [1, 1]);
  assert.deepEqual(body.sections[0].exercises.map((row: Row) => row.challengers), [[], []]);
  assert.equal(reads.filter((table) => table === "player_validation_attempts").length, 3);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(writes, []);
});

test("validation catalogue does not truncate large club populations or profiles", async () => {
  const data: Record<string, Row[]> = fixture();
  data.club_members = [data.club_members[0], ...Array.from({ length: 1001 }, (_, i) => ({
    user_id: "p" + i, club_id: "A", role: "player", is_active: true,
  }))];
  data.profiles = Array.from({ length: 1001 }, (_, i) => ({ id: "p" + i, first_name: "Player " + i, last_name: null, avatar_url: null }));
  data.validation_sections = [{ id: "section", slug: "putting", name: "Putting", sort_order: 1, is_active: true }];
  data.validation_exercises = [{ id: "first", section_id: "section", name: "First", sequence_no: 1, is_active: true }];
  const { db } = fakeDatabase(data);
  Object.assign(db, { auth: { getUser: async () => ({ data: { user: { id: "coach" } }, error: null }) } });
  const route = loadModule<{ GET: (req: Request) => Promise<Response> }>("app/api/coach/validations/route.ts", apiMocks(db));
  const response = await route.GET(request("/api/coach/validations"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.player_count, 1001);
  assert.equal(body.sections[0].exercises[0].player_count, 1001);
  assert.equal(body.sections[0].exercises[0].challengers.length, 1001);
  assert.equal(body.sections[0].exercises[0].challengers[1000].first_name, "Player 1000");
});

test("home uses all coaches' feedback, required answers and the actual training end", async () => {
  const data: Record<string, Row[]> = fixture();
  const end = new Date(Date.now() - 3600_000).toISOString();
  const start = new Date(Date.now() - 7200_000).toISOString();
  data.coach_groups[0].name = "Group A";
  data.club_events = [
    { id: "event-A", club_id: "A", group_id: "group-A", event_type: "training", status: "scheduled", starts_at: start, ends_at: end, requires_evaluation: true },
    { id: "ongoing", club_id: "A", group_id: "group-A", event_type: "training", status: "scheduled", starts_at: start,
      ends_at: new Date(Date.now() + 3600_000).toISOString(), requires_evaluation: true },
  ];
  data.club_event_attendees = [
    { event_id: "event-A", player_id: "player", coach_recorded_status: "present" },
    { event_id: "ongoing", player_id: "player", coach_recorded_status: null },
  ];
  data.club_event_coach_feedback = [{ event_id: "event-A", player_id: "player", coach_id: "colleague", engagement: 4, attitude: 4, performance: 4 }];
  data.club_event_evaluation_criteria = [{ id: "criterion", event_id: "event-A", is_enabled: true, snapshot_respondent: "coach",
    snapshot_is_required: true, snapshot_response_format: "yes_no", snapshot_choices: [{ value: true }] }];
  for (const answered of [false, true]) {
    data.club_event_evaluation_responses = answered ? [{ event_id: "event-A", player_id: "player", event_criterion_id: "criterion", respondent_role: "coach", value_json: true }] : [];
    const { db } = fakeDatabase(data);
    Object.assign(db, { auth: { getUser: async () => ({ data: { user: { id: "coach" } }, error: null }) } });
    const route = loadModule<{ GET: (req: Request) => Promise<Response> }>("app/api/coach/home/route.ts", apiMocks(db));
    const response = await route.GET(request("/api/coach/home"));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.pendingEvaluationCount, answered ? 0 : 1);
    assert.equal(body.pendingAttendanceCount, 0);
    assert.deepEqual(body.pendingEvalEvents.map((event: Row) => event.id), answered ? [] : ["event-A"]);
  }
});

test("completion loader reads beyond the database's page limit", async () => {
  const data = { club_event_attendees: Array.from({length: 1001}, (_, i) => ({ event_id: "event", player_id: String(i),
    coach_recorded_status: i === 1000 ? null : "absent" })) };
  const { db } = fakeDatabase(data);
  const { loadCoachEvaluationState } = loadModule<{ loadCoachEvaluationState: (db: SupabaseClient, ids: string[]) => Promise<{ attendees: unknown[]; completeByEvent: Record<string, boolean> }> }>("lib/server/coachEvaluation.ts");
  const result = await loadCoachEvaluationState(db, ["event"]);
  assert.equal(result.attendees.length, 1001);
  assert.equal(result.completeByEvent.event, false);
});

test("guided API forwards one atomic save with the caller identity and maps stale writes to 409", async () => {
  const playerId = "11111111-1111-4111-8111-111111111111";
  const { db, writes } = fakeDatabase({ club_event_attendees: [{ event_id: "event", player_id: playerId }] });
  const calls: Array<{ name: string; args: Row }> = [];
  Object.assign(db, { rpc: async (name: string, args: Row) => { calls.push({ name,args }); return { data: null, error: { message: "evaluation_conflict" } }; } });
  const route = loadModule<{ PUT: (req: Request, ctx: unknown) => Promise<Response> }>("app/api/coach/events/[eventId]/debrief/player/route.ts", {
    ...apiMocks(db), "@/app/api/coach/events/_access": { requireCoachEventAccess: async () => ({ event_type: "training" }) },
  });
  const response = await route.PUT(new Request("http://localhost/api/coach/events/event/debrief/player", {
    method: "PUT", headers: { Authorization: "Bearer test-only", "Content-Type": "application/json" },
    body: JSON.stringify({ player_id: playerId, coach_id: "forged", status: "present", engagement: 4, attitude: 4, performance: 4,
      expected_recorded_at: null, custom_responses: { criterion: false } }),
  }), { params: Promise.resolve({ eventId: "event" }) });
  assert.equal(response.status, 409);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "save_coach_training_player_evaluation_v2");
  assert.equal(calls[0].args.p_coach_id, "coach");
  assert.deepEqual(calls[0].args.p_custom_responses, { criterion: false });
  assert.deepEqual(writes, []);
});

test("an empty camp API patch delegates a no-op transaction, never delete/reinsert", async () => {
  const { db, writes } = fakeDatabase({});
  const calls: Array<{ name: string; args: Row }> = [];
  Object.assign(db, { rpc: async (name: string, args: Row) => { calls.push({ name,args }); return { data: { ok:true,updated_player_ids:[] }, error:null }; } });
  const route = loadModule<{ PATCH: (req: Request, ctx: unknown) => Promise<Response> }>("app/api/coach/camps/[campId]/registrations/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/camps/_lib": { createAdminClient: () => db, getCaller: async () => ({ userId:"coach" }), normalizeText: (value: unknown) => String(value ?? "").trim() },
  });
  const response = await route.PATCH(new Request("http://localhost/api/coach/camps/camp/registrations", {
    method:"PATCH", headers:{Authorization:"Bearer test-only","Content-Type":"application/json"},body:"{}",
  }), {params:Promise.resolve({campId:"camp"})});
  assert.equal(response.status,200);
  assert.deepEqual(calls,[{name:"patch_coach_camp_registrations_v1",args:{p_camp_id:"camp",p_actor_id:"coach",p_registrations:[]}}]);
  assert.deepEqual(writes,[]);
});

test("inactive or removed staff cannot regain event access via old assignments", async () => {
  for (const role of ["coach", "player"]) {
    const data = fixture();
    data.club_members[0] = { ...data.club_members[0], is_active: role === "player", role };
    data.coach_groups[0].head_coach_user_id = "coach";
    data.club_event_coaches.push({ event_id: "event-A", coach_id: "coach" });
    const { db } = fakeDatabase(data);
    assert.equal(await canCoachAccessEvent(db, "coach", "event-A", "group-A", "A"), false);
    const assignments = await resolveCoachAssignments(db, "coach");
    assert.deepEqual(assignments.groups, []);
    assert.deepEqual(assignments.eventIds, []);
  }
});

test("active membership alone does not authorize unrelated event access", async () => {
  const { db } = fakeDatabase(fixture());
  assert.equal(await canCoachAccessEvent(db, "coach", "event-A", "group-A", "A"), true);
  assert.equal(await canCoachAccessEvent(db, "coach", "event-B", "group-B", "B"), false);
});

test("an active assigned event coach and a same-club manager remain authorized", async () => {
  const data = fixture();
  data.club_event_coaches.push({ event_id: "event-B", coach_id: "coach" });
  assert.equal(await canCoachAccessEvent(fakeDatabase(data).db, "coach", "event-B", "group-B", "B"), true);
  data.club_event_coaches = [];
  data.club_members[1].role = "manager";
  assert.equal(await canCoachAccessEvent(fakeDatabase(data).db, "coach", "event-B", "group-B", "B"), true);
});

test("membership lookup failures fail closed", async () => {
  await assert.rejects(activeCoachMemberships(fakeDatabase(fixture(), "club_members").db, "coach"), /unavailable/);
});

test("missing per-coach AI policy fails closed without using the club-wide fallback", async () => {
  const { isCoachTrainingAssistanceEnabled } = loadModule<typeof import("../lib/server/coachTrainingAssistance")>("lib/server/coachTrainingAssistance.ts");
  const calls: string[] = [];
  const db = { rpc: async (name: string) => {
    calls.push(name);
    return { data: null, error: { code: "PGRST202", message: "function missing" } };
  } } as unknown as SupabaseClient;
  assert.equal(await isCoachTrainingAssistanceEnabled(db, "A", "coach"), false);
  assert.deepEqual(calls, ["is_coach_training_assistance_enabled_for_coach"]);
});

test("sensitive player access is computed separately for each club", async () => {
  const { resolveCoachPlayerAccess } = loadModule<typeof import("../app/api/coach/players/_access")>("app/api/coach/players/_access.ts");
  const data = fixture();
  const access = await resolveCoachPlayerAccess(fakeDatabase(data).db, "coach", "player");
  assert.deepEqual(access.sharedClubIds, ["A", "B"]);
  assert.deepEqual(access.sensitiveClubIds, ["A"]);
  data.coach_group_coaches = [];
  data.club_members[0].role = "manager";
  const manager = await resolveCoachPlayerAccess(fakeDatabase(data).db, "coach", "player");
  assert.deepEqual(manager.sensitiveClubIds, ["A"]);
});

test("a current head coach is recognized, but inactive groups do not unlock private player sections", async () => {
  const { resolveCoachPlayerAccess } = loadModule<typeof import("../app/api/coach/players/_access")>("app/api/coach/players/_access.ts");
  const data = fixture();
  data.coach_group_coaches = [];
  data.coach_groups[0].head_coach_user_id = "coach";
  assert.deepEqual((await resolveCoachPlayerAccess(fakeDatabase(data).db, "coach", "player")).sensitiveClubIds, ["A"]);
  data.coach_groups[0].is_active = false;
  assert.deepEqual((await resolveCoachPlayerAccess(fakeDatabase(data).db, "coach", "player")).sensitiveClubIds, []);
});

test("an event assignment without a player group does not grant player-wide private access", async () => {
  const { resolveCoachPlayerAccess } = loadModule<typeof import("../app/api/coach/players/_access")>("app/api/coach/players/_access.ts");
  const data = fixture();
  data.coach_group_coaches = [];
  data.club_event_coaches.push({ event_id: "event-A", coach_id: "coach" });
  const access = await resolveCoachPlayerAccess(fakeDatabase(data).db, "coach", "player");
  assert.deepEqual(access.sensitiveClubIds, []);
  assert.deepEqual(access.sharedEventIds, ["event-A"]);
});

test("only actual event participants pass the player guard", async () => {
  const { db } = fakeDatabase(fixture());
  await requireCoachEventPlayer(db, "event-A", "player");
  await assert.rejects(requireCoachEventPlayer(db, "event-A", "unrelated-player"), /unknown_attendee/);
});

test("private feedback API does not return another club's feedback", async () => {
  const data = { ...fixture(), club_event_coach_feedback: [
    { event_id: "event-A", player_id: "player", private_note: "note-A" },
    { event_id: "event-B", player_id: "player", private_note: "note-B" },
  ] };
  const { db, writes } = fakeDatabase(data);
  const route = loadModule<typeof import("../app/api/coach/players/[playerId]/feedback/route")>("app/api/coach/players/[playerId]/feedback/route.ts", apiMocks(db));
  const response = await route.GET(request("/api/coach/players/player/feedback") as never, { params: Promise.resolve({ playerId: "player" }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.feedback.map((row: Row) => row.private_note), ["note-A"]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(writes, []);
});

test("an inactive coach is rejected before any private feedback read", async () => {
  const data = fixture();
  data.club_members = data.club_members.map((row) => row.user_id === "coach" ? { ...row, is_active: false } : row);
  const { db, reads } = fakeDatabase(data);
  const route = loadModule<typeof import("../app/api/coach/players/[playerId]/feedback/route")>("app/api/coach/players/[playerId]/feedback/route.ts", apiMocks(db));
  const response = await route.GET(request("/api/coach/players/player/feedback") as never, { params: Promise.resolve({ playerId: "player" }) });
  assert.equal(response.status, 403);
  assert.equal(reads.includes("club_event_coach_feedback"), false);
});

test("individual detail rejects a non-participant before reading player data", async () => {
  const { db, reads } = fakeDatabase(fixture());
  const route = loadModule<typeof import("../app/api/coach/events/[eventId]/players/[playerId]/route")>("app/api/coach/events/[eventId]/players/[playerId]/route.ts", apiMocks(db));
  const response = await route.GET(request("/api/coach/events/event-A/players/unrelated") as never,
    { params: Promise.resolve({ eventId: "event-A", playerId: "unrelated" }) });
  assert.equal(response.status, 404);
  assert.equal(reads.includes("profiles"), false);
  assert.equal(reads.includes("club_event_coach_feedback"), false);
});

test("document list signs only documents from the authorized club", async () => {
  const { db } = fakeDatabase({ ...fixture(), player_dashboard_documents: [
    { id: "doc-A", organization_id: "A", player_id: "player" },
    { id: "doc-B", organization_id: "B", player_id: "player" },
  ] });
  const route = loadModule<typeof import("../app/api/coach/players/[playerId]/documents/route")>("app/api/coach/players/[playerId]/documents/route.ts", apiMocks(db));
  const response = await route.GET(request("/api/coach/players/player/documents") as never, { params: Promise.resolve({ playerId: "player" }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).documents.map((row: Row) => row.id), ["doc-A"]);
});

test("another club cannot be selected for document upload or deletion", async () => {
  const { db, writes } = fakeDatabase({ ...fixture(), player_dashboard_documents: [
    { id: "doc-B", organization_id: "B", player_id: "player", uploaded_by: "coach" },
  ] });
  const upload = loadModule<typeof import("../app/api/coach/players/[playerId]/documents/route")>("app/api/coach/players/[playerId]/documents/route.ts", apiMocks(db));
  const req = new Request("http://localhost/api/coach/players/player/documents", {
    method: "POST", headers: { Authorization: "Bearer test-only", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare", organization_id: "B", original_name: "document.pdf" }),
  });
  assert.equal((await upload.POST(req as never, { params: Promise.resolve({ playerId: "player" }) })).status, 400);
  const documents = loadModule<typeof import("../app/api/coach/players/[playerId]/documents/[documentId]/route")>("app/api/coach/players/[playerId]/documents/[documentId]/route.ts", apiMocks(db));
  assert.equal((await documents.DELETE(request("/documents/doc-B") as never,
    { params: Promise.resolve({ playerId: "player", documentId: "doc-B" }) })).status, 403);
  assert.deepEqual(writes, []);
});

test("team thread cannot be created in a club without a sensitive-player relationship", async () => {
  const { db, writes } = fakeDatabase(fixture());
  let created = false;
  const route = loadModule<typeof import("../app/api/coach/players/[playerId]/team-thread/route")>("app/api/coach/players/[playerId]/team-thread/route.ts", {
    ...apiMocks(db), "@/app/api/messages/teamThread": { ensurePlayerTeamThread: async () => { created = true; return {}; } },
  });
  const response = await route.GET(request("/api/coach/players/player/team-thread?organization_id=B") as never, { params: Promise.resolve({ playerId: "player" }) });
  assert.equal(response.status, 403);
  assert.equal(created, false);
  assert.deepEqual(writes, []);
});

test("retired evaluation and AI endpoints cannot perform any mutation or model request", async () => {
  const { db, reads, writes } = fakeDatabase(fixture());
  for (const path of ["app/api/coach/events/[eventId]/players/[playerId]/route.ts", "app/api/coach/ai/improve-comment/route.ts",
    "app/api/coach/events/[eventId]/debrief/analyze/route.ts", "app/api/coach/events/[eventId]/debrief/notes/route.ts"]) {
    const route = loadModule<{ POST: () => Promise<Response> }>(path, apiMocks(db));
    assert.equal((await route.POST()).status, 410);
  }
  const collective = loadModule<{ PUT: () => Promise<Response> }>("app/api/coach/events/[eventId]/debrief/route.ts", apiMocks(db));
  assert.equal((await collective.PUT()).status, 410);
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
});

test("all browser feedback readers use explicit non-private fields or an authorized API", () => {
  const files = [
    "app/coach/players/[playerId]/page.tsx",
    "app/coach/groups/[id]/planning/[eventId]/players/page.tsx",
    "app/manager/groups/[id]/planning/[eventId]/players/page.tsx",
    "app/manager/groups/[id]/planning/[eventId]/players/[playerId]/page.tsx",
    "app/manager/groups/[id]/planning/[eventId]/players/[playerId]/edit/page.tsx",
  ];
  for (const file of files) {
    assert.doesNotMatch(readFileSync(resolve(root, file), "utf8"), /\.from\("club_event_coach_feedback"\)\s*\.select\([^\n]*(?:private_note|\*)/);
  }
});
