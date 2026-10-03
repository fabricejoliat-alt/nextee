/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated UI/database fixtures, never live planning records. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerPlanningEntries } from "../lib/i18n/managerPlanningMessages.ts";
import { managerPlanningDate, managerPlanningFeedback } from "../lib/managerPlanningPresentation.ts";
import { coachComponentHarness, elements, textContent, flush, deferred } from "./helpers/coachComponentHarness.ts";
import { managerDatabase, loadManagerModule, type Row } from "./helpers/managerRouteHarness.ts";
const paths = ["app/manager/groups/[id]/planning/page.tsx", "app/manager/groups/[id]/planning/[eventId]/page.tsx"];
const locales: AppLocale[] = ["fr", "en", "de", "it"];
const t = (l: AppLocale) => (key: string) => messages[l][key] ?? key;
const msg = (l: AppLocale, key: string) => t(l)(`manager.planning.${key}`);
const ui = (tree: any) => elements(tree).map(n => [textContent(n), n.props.label, n.props.title, n.props["aria-label"]].filter(x => typeof x === "string").join(" ")).join(" ");
async function settle(h: ReturnType<typeof coachComponentHarness>) { let tree = h.render(); for (let i = 0; i < 5; i++) { await flush(); tree = h.render(); } return tree; }
function button(tree: any, label: string) { const found = elements(tree).find(n => n.type === "button" && (textContent(n).trim() === label || n.props["aria-label"] === label)); assert.ok(found, label); return found; }
function tabs(tree: any) { return elements(tree).find(n => n.type === "tabs")!; }
function tables(): Record<string, Row[]> { return {
  clubs: [{ id: "club", name: "Club maison" }], coach_groups: [{ id: "group", club_id: "club", name: "Groupe maison" }],
  club_events: [ { id: "event", group_id: "group", club_id: "club", event_type: "training", starts_at: "2020-02-03T09:00:00Z", ends_at: "2020-02-03T10:00:00Z", duration_minutes: 60, location_text: "Practice maison", coach_note: "Note maison", title: "Titre maison", requires_evaluation: true, series_id: "series", status: "scheduled" } ],
  // These attendees are no longer members of the group/club and must remain in activity history.
  club_event_attendees: [ { event_id: "event", player_id: "junior", status: "expected", coach_recorded_status: null }, { event_id: "event", player_id: "excused", status: "excused", coach_recorded_status: null } ],
  profiles: [ ["junior", "Léa"], ["excused", "Max"], ["old-coach", "Ancien coach"], ["new-coach", "Nouveau coach"] ].map(([id, first_name]) => ({ id, first_name, last_name: "Exemple", avatar_url: null, handicap: 0 })),
  club_event_coaches: [{ event_id: "event", coach_id: "old-coach" }],
  club_members: [{ club_id: "club", user_id: "new-coach", role: "coach", is_active: true }],
  club_event_structure_items: [{ event_id: "event", category: "putting", minutes: 30, note: "Note personnelle", position: 0 }],
}; }
function setup(path: string, opts: { data?: Record<string, Row[]>; from?: any; rpc?: any; request?: typeof fetch; params?: () => { id: string; eventId: string } } = {}) {
  const fixture = managerDatabase(opts.data ?? tables()); let reads = 0;
  const h = coachComponentHarness(path, { database: { from: (table: string) => { reads++; return (opts.from ?? fixture.db.from)(table); }, rpc: opts.rpc ?? (async () => ({ data: { event: { id: "event" }, future: [], structure: (opts.data ?? tables()).club_event_structure_items }, error: null })) },
    modules: { "next/navigation": { useParams: opts.params ?? (() => ({ id: "group", eventId: "event" })), useSearchParams: () => new URLSearchParams("season=season") } },
    fetch: opts.request ?? (async () => { throw new Error("Unexpected request"); }) });
  return { fixture, h, reads: () => reads };
}
function confirmed() { const previous = Object.getOwnPropertyDescriptor(globalThis, "window"); Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } }); return () => previous ? Object.defineProperty(globalThis, "window", previous) : Reflect.deleteProperty(globalThis, "window"); }

test("planning messages, accessible labels and dates resolve in all four languages", () => {
  for (const [key, values] of Object.entries(managerPlanningEntries)) for (const l of locales) {
    const tokens = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
    assert.deepEqual(tokens(msg(l, key)), tokens(values[0]), `${l}:${key}`);
    assert.equal(managerPlanningFeedback(t(l), `manager.planning.${key}`), msg(l, key));
  }
  for (const path of paths) {
    const source = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, source, 99, true, ts.ScriptKind.TSX);
    function visit(n: ts.Node) { if (ts.isJsxText(n)) assert.doesNotMatch(n.text, /[A-Za-zÀ-ÿ]{2}/, `${path}:${n.text}`); if (ts.isJsxAttribute(n) && ["label", "title", "aria-label", "placeholder"].includes(n.name.getText(ast)) && n.initializer && ts.isStringLiteral(n.initializer)) assert.doesNotMatch(n.initializer.text, /[A-Za-zÀ-ÿ]{2}/, path); ts.forEachChild(n, visit); } visit(ast);
    for (const [, key] of source.matchAll(/\bt\("([^"]+)"\)/g)) for (const l of locales) assert.ok(messages[l][key], `${l}:${key}`);
  }
  assert.equal(managerPlanningDate("2026-01-02T23:30:00Z", null, "fr").date, "03");
  assert.equal(managerPlanningDate("invalid", null, "de").date, "—");
  assert.equal(managerPlanningFeedback(t("it"), "common.errorLoading"), t("it")("common.errorLoading"));
});

test("planning filters and historic rosters survive language changes; unconfirmed attendance is not absent", async () => {
  const data = tables(); data.club_events.push({ ...data.club_events[0], id: "cancelled", status: "cancelled" }); data.club_event_attendees.push({ ...data.club_event_attendees[0], event_id: "cancelled" });
  const x = setup(paths[0], { data }); let tree = await settle(x.h); tabs(tree).props.onChange("past"); tree = await settle(x.h);
  assert.ok(ui(tree).includes("Léa Exemple")); assert.ok(ui(tree).includes("Ancien coach Exemple")); assert.ok(ui(tree).includes(msg("fr", "expected"))); assert.ok(ui(tree).includes(msg("fr", "excused")));
  assert.match(tabs(tree).props.items.find((i: any) => i.value === "pending").label, /\(1\)$/);
  tabs(tree).props.onChange("pending"); tree = await settle(x.h); assert.equal(elements(tree).filter(n => n.type === "article").length, 1);
  const before = x.reads(); for (const locale of locales) { x.h.setLocale(locale); tree = await settle(x.h); assert.equal(x.reads(), before); assert.equal(tabs(tree).props.value, "pending"); assert.ok(ui(tree).includes("Groupe maison")); assert.ok(ui(tree).includes(msg(locale, "expected"))); assert.doesNotMatch(ui(tree), /manager\.planning\./); }
  assert.ok(elements(tree).some(n => n.props.href === "/manager/groups/group?season=season")); x.h.cleanup();
});

test("failed deletion keeps its error visible and permits a deliberate retry", async () => {
  const restore = confirmed(); let calls = 0; const wait = deferred<Response>();
  const x = setup(paths[0], { request: async () => { calls++; return calls === 1 ? wait.promise : Response.json({ ok: true }); } });
  try { let tree = await settle(x.h); tabs(tree).props.onChange("past"); tree = await settle(x.h); const before = x.reads(), action = button(tree, t("fr")("common.delete")); const first = action.props.onClick(); await action.props.onClick(); assert.equal(calls, 1); wait.resolve(Response.json({ error: "Deletion denied" }, { status: 403 })); await first; tree = await settle(x.h); assert.equal(x.reads(), before); assert.ok(elements(tree).some(n => n.props.role === "alert" && textContent(n).includes("Deletion denied"))); assert.equal(button(tree, t("fr")("common.delete")).props.disabled, false); await button(tree, t("fr")("common.delete")).props.onClick(); assert.equal(calls, 2); }
  finally { x.h.cleanup(); restore(); }
});

test("pending evaluations include other coaches, recorded attendance, required criteria and paginated attendees", async () => {
  const planning = loadManagerModule("lib/managerPlanningEvaluation.ts", {});
  const data: Record<string, Row[]> = { club_event_attendees: Array.from({ length: 501 }, (_, i) => ({ event_id: "many", player_id: `p${i}`, coach_recorded_status: i === 500 ? null : "absent" })), club_event_coach_feedback: [], club_event_evaluation_criteria: [], club_event_evaluation_responses: [] };
  for (const id of ["done", "missing-criteria", "unconfirmed"]) {
    data.club_event_attendees.push({ event_id: id, player_id: "junior", coach_recorded_status: id === "unconfirmed" ? null : "present" });
    data.club_event_coach_feedback.push({ event_id: id, player_id: "junior", coach_id: "another-coach", engagement: 4, attitude: 4, performance: 4 });
    data.club_event_evaluation_criteria.push({ id: `${id}-criterion`, event_id: id, is_enabled: true, snapshot_respondent: "coach", snapshot_is_required: true, snapshot_response_format: "short_text", snapshot_choices: [] });
  }
  data.club_event_evaluation_responses.push({ event_id: "done", player_id: "junior", event_criterion_id: "done-criterion", respondent_role: "coach", value_json: "Complete" });
  const result = await planning.managerPlanningPendingEvents(managerDatabase(data).db, ["many", "done", "missing-criteria", "unconfirmed"]);
  assert.deepEqual([...result].sort(), ["many", "missing-criteria", "unconfirmed"]);
  await assert.rejects(planning.managerPlanningPendingEvents(managerDatabase(data, { failureTable: "club_event_evaluation_responses" }).db, ["done"]), /Database failure/);
});

for (const series_id of [null, "series"]) test(`Manager detail displays saved structure from the scoped snapshot (${series_id ?? "single"})`, async () => {
  const data = tables(); data.club_events[0].series_id = series_id;
  const base = managerDatabase(data), calls: any[] = [];
  const x = setup(paths[1], { data, from: (table: string) => {
    assert.notEqual(table, "club_event_structure_items", "participant-only table reads must not hide Manager structure");
    return base.db.from(table);
  }, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { event: data.club_events[0], structure: data.club_event_structure_items, future: [] }, error: null }; } });
  try { const tree = await settle(x.h); assert.ok(ui(tree).includes("Note personnelle")); assert.ok(!ui(tree).includes(msg("fr", "noStructure"))); assert.deepEqual(calls, [{ name: "get_manager_planning_snapshot_v1", args: { p_event_id: "event" } }]); }
  finally { x.h.cleanup(); }
});

test("a denied structure snapshot shows an error instead of claiming that saved structure is empty", async () => {
  const x = setup(paths[1], { rpc: async () => ({ data: null, error: { code: "42501", message: "forbidden" } }) });
  try { const tree = await settle(x.h); assert.ok(elements(tree).some(n => n.props.role === "alert")); assert.ok(!ui(tree).includes(msg("fr", "noStructure"))); assert.equal(x.fixture.writes.length, 0); }
  finally { x.h.cleanup(); }
});

test("copy uses the loaded snapshot, rejects duplicate clicks and keeps translated success on language changes", async () => {
  const restore = confirmed(), calls: any[] = [], wait = deferred<any>(), snapshot = { event: { id: "event" }, future: [{ event: { id: "future" } }], structure: [{ category: "putting", minutes: 30, note: "Note personnelle" }] };
  const x = setup(paths[1], { rpc: async (name: string, args: any) => { calls.push({ name, args }); return name === "get_manager_planning_snapshot_v1" ? { data: snapshot, error: null } : wait.promise; } });
  try { let tree = await settle(x.h); const copy = button(tree, msg("fr", "copyFuture")); const first = copy.props.onClick(); await copy.props.onClick(); assert.equal(calls.length, 2); assert.deepEqual(calls[1], { name: "copy_manager_event_structure_v1", args: { p_event_id: "event", p_expected: snapshot } }); assert.equal(x.fixture.writes.length, 0); wait.resolve({ data: { copied: 1 }, error: null }); await first; tree = await settle(x.h); assert.ok(ui(tree).includes(msg("fr", "copyOne"))); const before = x.reads(); for (const l of locales) { x.h.setLocale(l); tree = await settle(x.h); assert.ok(ui(tree).includes(msg(l, "copyOne"))); assert.ok(ui(tree).includes("Note personnelle")); assert.equal(x.reads(), before); assert.equal(button(tree, msg(l, "copyFuture")).props.disabled, true); assert.doesNotMatch(ui(tree), /manager\.planning\./); } }
  finally { x.h.cleanup(); restore(); }
});

for (const error of [{ code: "PGRST202", message: "Function not found", key: "migrationRequired" }, { code: "40001", message: "planning_conflict", key: "copyConflict" }]) test(`copy ${error.code} is an accessible translated error without destructive fallback`, async () => {
  const restore = confirmed(); const x = setup(paths[1], { rpc: async (name: string) => name === "get_manager_planning_snapshot_v1" ? { data: { event: {}, structure: tables().club_event_structure_items }, error: null } : { data: null, error } });
  try { let tree = await settle(x.h); await button(tree, msg("fr", "copyFuture")).props.onClick(); tree = await settle(x.h); assert.ok(elements(tree).some(n => n.props.role === "alert" && textContent(n).includes(msg("fr", error.key)))); assert.equal(x.fixture.writes.length, 0); assert.equal(button(tree, msg("fr", "copyFuture")).props.disabled, false); }
  finally { x.h.cleanup(); restore(); }
});

test("attendance failures restore the previous status and unlock retry; coach replacements are serialized", async () => {
  const base = managerDatabase(tables()), wait = deferred<Response>(); let fail = true, requests = 0;
  const x = setup(paths[1], { from: (table: string) => { const q = base.db.from(table), update = q.update, then = q.then; let write = false; q.update = (values: any) => { write = true; return update(values); }; q.then = (yes: any, no: any) => write && fail ? Promise.resolve({ error: { message: "Attendance failed" } }).then(yes, no) : then(yes, no); return q; }, request: async () => { requests++; return wait.promise; } });
  let tree = await settle(x.h); const row = () => elements(tree).find(n => n.type === "tr" && textContent(n).includes("Léa Exemple"))!;
  assert.equal(elements(row()).find(n => n.props.href === "#")?.props["aria-disabled"], true);
  await button(row(), t("fr")("manager.content.present")).props.onClick(); tree = await settle(x.h); assert.ok(textContent(row()).includes(msg("fr", "expected"))); assert.equal(button(row(), t("fr")("manager.content.present")).props.disabled, false);
  fail = false; await button(row(), t("fr")("manager.content.present")).props.onClick(); tree = await settle(x.h); assert.ok(elements(row()).some(n => n.props.href?.endsWith("/junior/edit"))); assert.equal(base.writes[0].values.status, "present");
  const add = button(tree, "Ajouter Nouveau coach Exemple").props.onClick(); await flush(); tree = x.h.render(); assert.equal(button(tree, "Retirer Ancien coach Exemple").props.disabled, true); await button(tree, "Retirer Ancien coach Exemple").props.onClick(); assert.equal(requests, 1); wait.resolve(Response.json({ ok: true })); await add; tree = await settle(x.h); assert.ok(button(tree, "Retirer Nouveau coach Exemple")); x.h.cleanup();
});

test("an older activity response cannot replace the activity selected in the current route", async () => {
  const data = tables(); data.club_events.push({ ...data.club_events[0], id: "other", location_text: "Second practice", series_id: null });
  const base = managerDatabase(data), wait = deferred<any>(); let eventId = "event";
  const x = setup(paths[1], { params: () => ({ id: "group", eventId }), from: (table: string) => { const q = base.db.from(table), eq = q.eq, then = q.then; let old = false; q.eq = (key: string, value: unknown) => { if (table === "club_events" && key === "id" && value === "event") old = true; return eq(key, value); }; q.then = (yes: any, no: any) => old ? wait.promise.then(yes, no) : then(yes, no); return q; } });
  x.h.render(); await flush(); eventId = "other"; let tree = await settle(x.h); assert.ok(ui(tree).includes("Second practice")); wait.resolve({ data: data.club_events[0], error: null }); tree = await settle(x.h); assert.ok(ui(tree).includes("Second practice")); assert.ok(!ui(tree).includes("Practice maison")); x.h.cleanup();
});
