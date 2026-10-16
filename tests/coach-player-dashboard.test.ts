import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { dashboardAttendance, dashboardTrainingPeriod, type DashboardEvent, type DashboardSession } from "../lib/coachPlayerDashboard.ts";

const period = { from: "2026-01-01", to: "2026-01-31" };
const now = Date.parse("2026-02-01T00:00:00Z");
const event = (id: string, changes: Partial<DashboardEvent> = {}): DashboardEvent => ({ id, club_id: "A", starts_at: "2026-01-12T10:00:00Z", ends_at: "2026-01-12T11:00:00Z", duration_minutes: 60, status: "scheduled", event_type: "training", ...changes });
const session = (id: string, changes: Partial<DashboardSession> = {}): DashboardSession => ({ id, start_at: "2026-01-12T10:00:00Z", total_minutes: 60, session_type: "individual", club_id: null, club_event_id: null, coach_user_id: null, motivation: null, difficulty: null, satisfaction: null, ...changes });

test("attendance counts recorded present and absent, excluding declarations, cancelled, future and other activities", () => {
  const events = [event("present"), event("absent"), event("declared"), event("cancelled", { status: "cancelled" }), event("future", { starts_at: "2026-01-31T23:45:00Z", ends_at: null }), event("camp", { event_type: "camp" }), event("outside", { starts_at: "2025-12-31T10:00:00Z" })];
  const attendance = events.map(row => ({ event_id: row.id, status: "present", coach_recorded_status: row.id === "absent" ? "absent" : row.id === "declared" ? null : "present" }));
  assert.deepEqual(dashboardAttendance(events, attendance, period, now), { present: 1, total: 2, rate: 50 });
  assert.deepEqual(dashboardAttendance([event("declared")], attendance, period, now), { present: 0, total: 0, rate: null });
});

test("a coach-recorded absence overrides a player's declared presence", () => {
  const result = dashboardTrainingPeriod({ sessions: [], items: [], events: [event("absent")], attendance: [{ event_id: "absent", status: "present", coach_recorded_status: "absent" }], period, performance: false, now });
  assert.equal(result.minutes, 0);
  assert.deepEqual(result.attendance, { present: 0, total: 1, rate: 0 });
});

test("mixed detailed and total-only sessions use the same minutes for totals and charts", () => {
  const result = dashboardTrainingPeriod({ sessions: [session("structured", { total_minutes: 999 }), session("manual"), session("outside", { start_at: "2026-02-01T00:00:00Z" })], items: [{ session_id: "structured", category: "putting", minutes: 30 }, { session_id: "structured", category: "driving", minutes: 45 }], events: [], attendance: [], period, performance: true, now });
  assert.equal(result.count, 2);
  assert.equal(result.minutes, 135);
  assert.equal(result.items.length, 2);
});

test("non-performance club activities are charted once alongside personal training", () => {
  const result = dashboardTrainingPeriod({ sessions: [session("duplicate", { session_type: "club", club_event_id: "club" }), session("manual")], items: [], events: [event("club", { duration_minutes: null })], attendance: [{ event_id: "club", status: "present", coach_recorded_status: "present" }], period, performance: false, now });
  assert.equal(result.minutes, 120);
  assert.equal(result.count, 2);
  assert.equal(result.sessions.filter(row => row.session_type === "club").length, 1);
});

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
function loadModule<T = unknown>(path: string, mocks: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(resolve(root, path), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", code)((id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("@/") || id.startsWith(".")) {
      const base = id.startsWith("@/") ? id.slice(2) : resolve(dirname(path), id);
      return loadModule(existsSync(resolve(root, base)) ? base : `${base}.ts`, mocks);
    }
    return require(id);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports as T;
}

type Row = Record<string, unknown>;
const club = "00000000-0000-4000-8000-000000000001";
const foreignClub = "00000000-0000-4000-8000-000000000002";
function database(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const db = { from(table: string) {
    let rows = [...(tables[table] ?? [])];
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return query; },
      neq(key: string, value: unknown) { rows = rows.filter(row => row[key] !== value); return query; },
      in(key: string, value: unknown[]) { rows = rows.filter(row => value.includes(row[key])); return query; },
      or(filter: string) { assert.equal(filter, `club_id.is.null,club_id.in.(${club})`); rows = rows.filter(row => row.club_id === null || row.club_id === club); return query; },
      gte(key: string, value: string) { rows = rows.filter(row => String(row[key]) >= value); return query; },
      lt(key: string, value: string) { rows = rows.filter(row => String(row[key]) < value); return query; },
      order() { return query; },
      range(from: number, to: number) { rows = rows.slice(from, to + 1); return query; },
      limit(count: number) { rows = rows.slice(0, count); return query; },
      then(done: (value: unknown) => unknown) { reads.push(table); return Promise.resolve({ data: rows, error: null }).then(done); },
    };
    return query;
  } };
  return { db, reads };
}
function route(tables: Record<string, Row[]>, allowed = true) {
  const { db, reads } = database(tables);
  const { GET } = loadModule<{ GET: (request: Request, context: { params: Promise<{ playerId: string }> }) => Promise<Response> }>("app/api/coach/players/[playerId]/dashboard/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/messages/_lib": { requireCaller: async () => ({ supabaseAdmin: db, callerId: "coach" }) },
    "@/app/api/coach/players/_access": { resolveCoachPlayerAccess: async () => ({ sharedClubIds: allowed ? [club] : [] }) },
  });
  const get = (query = "", token = true) => {
    const url = `http://localhost/api/coach/players/player/dashboard?${query}`;
    const request = Object.assign(new Request(url, { headers: token ? { Authorization: "Bearer test" } : {} }), { nextUrl: new URL(url) });
    return GET(request, { params: Promise.resolve({ playerId: "player" }) }) as Promise<Response>;
  };
  return { get, reads };
}

test("dashboard denies missing authentication and unrelated coaches before any sports reads", async () => {
  const api = route({}, false);
  assert.equal((await api.get("", false)).status, 401);
  assert.equal((await api.get()).status, 403);
  assert.deepEqual(api.reads, []);
});

test("invalid or reversed dates fail before database reads", async () => {
  const api = route({});
  for (const query of ["from=2026-02-30", "from=2026-13-01", "from=2026-03-02&to=2026-03-01", "prev_from=2025-01-01"]) assert.equal((await api.get(query)).status, 400);
  assert.deepEqual(api.reads, []);
});

test("stats read only the authorized player's personal and shared-club rounds and their holes", async () => {
  const rounds = [{ id: "own", user_id: "player", club_id: club }, { id: "personal", user_id: "player", club_id: null }, { id: "foreign", user_id: "player", club_id: foreignClub }, { id: "other-player", user_id: "other", club_id: club }].map(row => ({ ...row, start_at: "2026-01-12T10:00:00Z" }));
  const api = route({ golf_rounds: rounds, golf_round_holes: rounds.map(row => ({ round_id: row.id, hole_no: 1, score: 4 })) });
  const response = await api.get("view=stats&from=2026-01-01&to=2026-01-31");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.rounds.map((row: Row) => row.id), ["own", "personal"]);
  assert.deepEqual(body.holes.map((row: Row) => row.round_id), ["own", "personal"]);
  assert.ok(!api.reads.includes("training_sessions"));
  assert.equal(body.training, null);
});

test("round and hole histories are paginated beyond the PostgREST row cap", async () => {
  const rounds = Array.from({ length: 620 }, (_, i) => ({ id: `r${i}`, user_id: "player", club_id: null, start_at: "2026-01-12T10:00:00Z" }));
  const holes = rounds.flatMap(round => Array.from({ length: 18 }, (_, i) => ({ round_id: round.id, hole_no: i + 1, score: 4 })));
  const api = route({ golf_rounds: rounds, golf_round_holes: holes });
  const body = await (await api.get("view=stats")).json();
  assert.equal(body.rounds.length, 620);
  assert.equal(body.holes.length, 11160);
});

test("overview skips hole details and separates current and previous training periods", async () => {
  const api = route({ training_sessions: [session("current"), session("previous", { start_at: "2025-12-15T10:00:00Z" })].map(row => ({ ...row, user_id: "player" })), club_members: [{ id: "membership", user_id: "player", club_id: club, role: "player", is_active: true, is_performance: true }] });
  const body = await (await api.get("view=overview&from=2026-01-01&to=2026-01-31&prev_from=2025-12-01&prev_to=2025-12-31")).json();
  assert.equal(body.training.current.count, 1);
  assert.equal(body.training.current.minutes, 60);
  assert.equal(body.training.previous.count, 1);
  assert.ok(!api.reads.includes("golf_round_holes"));
});
