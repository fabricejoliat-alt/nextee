import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coachCalendarInitialPeriod, coachCalendarInPeriod, COACH_PENDING_EVALUATIONS_HREF } from "../lib/coachCalendarPeriod.ts";
import { coachCalendarActionState } from "../lib/coachCalendar.ts";
import { loadCoachPreparationStatus } from "../lib/server/coachPreparationStatus.ts";
import { loadCoachPreparationSources } from "../lib/server/coachPreparationSources.ts";
import { loadCoachPreparationReads } from "../lib/server/coachPreparationReads.ts";
import { coachRows } from "../lib/server/coachRows.ts";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
function loadRoute(path: string, mocks: Record<string, unknown>): { PUT: (request: Request, context: unknown) => Promise<Response> } {
  const compiled = ts.transpileModule(readFileSync(resolve(root, path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("@/") || id.startsWith(".")) {
      const base = id.startsWith("@/") ? id.slice(2) : resolve(path, "..", id);
      return loadRoute(existsSync(resolve(root, base)) ? base : base + ".ts", mocks);
    }
    return require(id);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports as ReturnType<typeof loadRoute>;
}
type Row = Record<string, unknown>;
const player = "00000000-0000-4000-8000-000000000001";
const event = { id: "future", group_id: "group", club_id: "club", event_type: "training", starts_at: "2099-10-02T10:00:00Z", status: "scheduled" };
function fixture() {
  return {
    club_events: [{ id: "past", group_id: "group", club_id: "club", event_type: "training", starts_at: "2020-09-01T10:00:00Z", ends_at: "2020-09-01T11:00:00Z", duration_minutes: 60, status: "scheduled" }],
    club_event_attendees: [{ event_id: "future", player_id: player }],
    club_event_coach_feedback: [{ event_id: "past", player_id: player, private_note: "Prévoir des balles.", updated_at: "2020-09-01T12:00:00Z" }],
    coach_player_private_notes: [],
    coach_training_preparation_insights: [] as Row[],
    coach_training_preparation_reads: [] as Row[],
  };
}
function database(tables: Record<string, Row[]>, missingReads = false) {
  const writes: Row[] = [], reads: string[] = [];
  const db = {
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      let rows = [...(tables[table] ?? [])], single = false, payload: Row | null = null;
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        neq(key: string, value: unknown) { rows = rows.filter((row) => row[key] !== value); return query; },
        in(key: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        lt(key: string, value: string) { rows = rows.filter((row) => String(row[key]) < value); return query; },
        order() { return query; }, limit(count: number) { rows = rows.slice(0, count); return query; },
        range(from: number, to: number) { rows = rows.slice(from, to + 1); return query; },
        maybeSingle() { single = true; return query; }, single() { single = true; return query; },
        upsert(value: Row) { payload = value; return query; },
        then(yes: (value: unknown) => unknown) {
          if (missingReads && table === "coach_training_preparation_reads") return Promise.resolve({ data: null, error: { code: "PGRST205", message: "Missing table" } }).then(yes);
          if (payload) {
            writes.push(payload);
            const target = tables[table] ??= [];
            const existing = target.findIndex((row) => row.target_event_id === payload!.target_event_id && row.player_id === payload!.player_id && row.coach_id === payload!.coach_id);
            if (existing < 0) target.push(payload); else target[existing] = payload;
            rows = [payload];
          } else reads.push(table);
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(yes);
        },
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, writes, reads };
}
test("pending links select the annual view; explicit periods still work", () => {
  assert.equal(coachCalendarInitialPeriod("evaluations", null), "year");
  assert.equal(coachCalendarInitialPeriod("all", null), "month");
  assert.equal(coachCalendarInitialPeriod("evaluations", "week"), "week");
  assert.equal(COACH_PENDING_EVALUATIONS_HREF, "/coach/calendar?view=evaluations&period=year");
});
test("calendar years include leap day, exclude the next year, and weeks start Monday", () => {
  const anchor = new Date(2024, 5, 18);
  assert.equal(coachCalendarInPeriod(new Date(2024, 1, 29, 12).toISOString(), anchor, "year"), true);
  assert.equal(coachCalendarInPeriod(new Date(2025, 0, 1).toISOString(), anchor, "year"), false);
  assert.equal(coachCalendarInPeriod("not-a-date", anchor, "year"), false);
  assert.equal(coachCalendarInPeriod(new Date(2024, 5, 17).toISOString(), anchor, "week"), true);
  assert.equal(coachCalendarInPeriod(new Date(2024, 5, 24).toISOString(), anchor, "week"), false);
});
test("pending preparation has a blue action; seen or no points has a green eye", () => {
  const future = { ...event, ends_at: null, duration_minutes: 60 };
  assert.equal(coachCalendarActionState({ ...future, preparation_pending: true }, false, Date.now()), "prepare_training");
  assert.equal(coachCalendarActionState({ ...future, preparation_pending: false }, false, Date.now()), "view_activity");
  assert.equal(coachCalendarActionState({ ...future, preparation_pending: true, requires_evaluation: false }, false, Date.now()), "prepare_training");
  assert.equal(coachCalendarActionState({ ...future, status: "cancelled", preparation_pending: true }, false, Date.now()), "view_activity");
});
test("unseen, coach-isolated and changed private sources remain pending without generating AI", async () => {
  const tables = fixture(); const { db, writes } = database(tables);
  const sources = await loadCoachPreparationSources(db, event, [player]);
  const hash = sources.sourceByPlayerId.get(player)!.sourceHash;
  assert.equal((await loadCoachPreparationStatus(db, "coach-A", [event])).future, true);
  tables.coach_training_preparation_reads.push({ target_event_id: "future", player_id: player, coach_id: "coach-A", source_fingerprint: hash, seen_at: "2026-10-01" });
  assert.equal((await loadCoachPreparationStatus(db, "coach-A", [event])).future, false);
  assert.equal((await loadCoachPreparationStatus(db, "coach-B", [event])).future, true);
  tables.club_event_coach_feedback[0].private_note = "Nouvelle consigne.";
  assert.equal((await loadCoachPreparationStatus(db, "coach-A", [event])).future, true);
  tables.club_event_coach_feedback[0].private_note = "";
  assert.equal((await loadCoachPreparationStatus(db, "coach-A", [event])).future, false);
  assert.deepEqual(writes, []);
});
test("all players with sources must be seen and the migration fallback never claims success", async () => {
  const tables = fixture(); const { db } = database(tables, true);
  assert.deepEqual(await loadCoachPreparationReads(db, "coach", ["future"]), { rows: [], available: false });
  assert.equal((await loadCoachPreparationStatus(db, "coach", [event])).future, true);
  const other = "00000000-0000-4000-8000-000000000002";
  tables.club_event_attendees.push({ event_id: "future", player_id: other });
  tables.club_event_coach_feedback.push({ ...tables.club_event_coach_feedback[0], player_id: other });
  const normal = database(tables).db;
  const sources = await loadCoachPreparationSources(normal, event, [player, other]);
  tables.coach_training_preparation_reads.push({ target_event_id: "future", player_id: player, coach_id: "coach", source_fingerprint: sources.sourceByPlayerId.get(player)!.sourceHash });
  assert.equal((await loadCoachPreparationStatus(normal, "coach", [event])).future, true);
  tables.coach_training_preparation_reads.push({ target_event_id: "future", player_id: other, coach_id: "coach", source_fingerprint: sources.sourceByPlayerId.get(other)!.sourceHash });
  assert.equal((await loadCoachPreparationStatus(normal, "coach", [event])).future, false);
});
test("seen API checks live sources, attendance and caller identity, then persists a reloadable acknowledgement", async () => {
  const tables = fixture(); const { db, writes } = database(tables);
  const hash = (await loadCoachPreparationSources(db, event, [player])).sourceByPlayerId.get(player)!.sourceHash;
  tables.coach_training_preparation_insights.push({ target_event_id: event.id, player_id: player, source_fingerprint: hash, attention_points: [{ text: "Prévoir des balles." }] });
  let allowed = true;
  const route = loadRoute("app/api/coach/events/[eventId]/preparation-seen/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/messages/_lib": { requireCaller: async () => ({ supabaseAdmin: db, callerId: "authenticated-coach" }) },
    "@/app/api/coach/events/_access": { requireCoachEventAccess: async () => { if (!allowed) throw new Error("forbidden"); return event; } },
  });
  const request = (body: Row, token = true) => new Request("http://localhost/api/coach/events/future/preparation-seen", { method: "PUT", headers: token ? { Authorization: "Bearer test-only", "Content-Type": "application/json" } : {}, body: JSON.stringify(body) });
  const context = { params: Promise.resolve({ eventId: "future" }) };
  const body = { player_id: player, source_fingerprint: hash, coach_id: "forged-other-coach" };
  assert.equal((await route.PUT(request(body, false), context)).status, 401);
  allowed = false;
  assert.equal((await route.PUT(request(body), context)).status, 403);
  allowed = true;
  assert.equal((await route.PUT(request({ ...body, player_id: "00000000-0000-4000-8000-000000000099" }), context)).status, 403);
  assert.equal((await route.PUT(request({ ...body, source_fingerprint: "a".repeat(64) }), context)).status, 409);
  assert.equal(writes.length, 0);
  assert.equal((await route.PUT(request(body), context)).status, 200);
  assert.equal(writes[0].coach_id, "authenticated-coach");
  assert.equal((await loadCoachPreparationStatus(db, "authenticated-coach", [event])).future, false);
  await route.PUT(request(body), context);
  assert.equal(tables.coach_training_preparation_reads.length, 1);
  tables.club_event_coach_feedback[0].private_note = "Nouveau point.";
  assert.equal((await route.PUT(request(body), context)).status, 409);
});
test("pending event pagination is complete beyond a database page", async () => {
  const all = Array.from({ length: 1207 }, (_, id) => ({ id }));
  const rows = await coachRows<{ id: number }>(async (from, to) => ({ data: all.slice(from, to + 1), error: null }));
  assert.equal(rows.length, 1207);
});
