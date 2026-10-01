import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCoachPlanningRoster } from "../lib/coachPlanningRoster.ts";
import { messages } from "../lib/i18n/messages.ts";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";

const page = "app/coach/groups/[id]/planning/add/page.tsx";
type Result = { data: unknown; error: unknown };
const ok = (replayed = false): Result => ({ data: { ok: true, event_ids: ["created"], series_id: null, replayed }, error: null });
function database(save: (args: Record<string, unknown>) => Promise<Result>, options: { permission?: boolean; count?: number; failTable?: string } = {}) {
  const calls: Record<string, unknown>[] = [], reads: { table: string; select: string; ids: string[] }[] = [];
  const juniors = Array.from({ length: options.count ?? 1 }, (_, index) => ({ user_id: `player-${index}`, role: "player" }));
  return { calls, reads,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "can_manage_assigned_group") return { data: options.permission ?? true, error: null };
      assert.equal(name, "create_coach_events_v1"); calls.push(args); return save(args);
    },
    from(table: string) {
      let columns = "", ids: string[] = [], start = 0, end = Infinity;
      const query = {
        select(value: string) { columns = value; return query; }, eq() { return query; }, order() { return query; },
        in(_column: string, values: string[]) { ids = values; return query; },
        range(from: number, to: number) { start = from; end = to; return query; }, maybeSingle() { return query; },
        insert() { throw new Error("Unexpected direct insert"); }, update() { throw new Error("Unexpected direct update"); }, delete() { throw new Error("Unexpected direct delete"); },
        then(resolve: (value: Result) => unknown) {
          reads.push({ table, select: columns, ids });
          let data: unknown = [];
          if (table === "coach_groups") data = { id: "group", club_id: "club", name: "Test group", head_coach_user_id: "coach" };
          if (table === "clubs") data = { name: "Test club" };
          if (table === "club_members") data = [...juniors, { user_id: "coach", role: "coach" }, { user_id: "guest", role: "parent" }].slice(start, end + 1);
          if (table === "coach_group_coaches") data = [{ coach_user_id: "inactive" }].slice(start, end + 1);
          if (table === "coach_group_players") data = [...juniors.map(row => ({ player_user_id: row.user_id })), { player_user_id: "guest" }].slice(start, end + 1);
          if (table === "profiles") data = ids.map(id => columns === "id,handicap" ? { id, handicap: 12.4 } : { id, first_name: id, last_name: "Test", avatar_url: null });
          return Promise.resolve({ data, error: table === options.failTable ? { message: "private failure" } : null }).then(resolve);
        },
      }; return query;
    },
  };
}
const find = (tree: Element, predicate: (node: Element) => boolean) => { const node = elements(tree).find(predicate); assert.ok(node); return node; };
const button = (tree: Element, key: string, locale: "fr" | "en" | "de" | "it" = "fr") => find(tree, node => node.type === "button" && textContent(node).trim() === messages[locale][key]);
const place = (tree: Element) => find(tree, node => node.type === "input" && node.props.placeholder === messages.fr["coach.form.locationExample"]);
async function init(db: ReturnType<typeof database>, notify?: (input: unknown) => Promise<unknown>) {
  const navigation: string[] = [];
  const harness = coachComponentHarness(page, { params: { id: "group" }, database: db, fetch: async () => { throw new Error("Unexpected fetch"); }, notify, navigate: path => navigation.push(path) });
  harness.render(); await flush(); harness.render(); return { harness, navigation };
}

test("creation uses one atomic request, includes the head coach and prevents double submits", async () => {
  const pending = deferred<Result>(), db = database(async () => pending.promise); const { harness, navigation } = await init(db);
  try {
    const submit = button(harness.render(), "coach.form.create").props.onClick; submit(); submit(); await flush();
    assert.equal(db.calls.length, 1); assert.deepEqual(db.calls[0].p_coach_ids, ["coach"]); assert.deepEqual(db.calls[0].p_player_ids, ["player-0"]);
    assert.equal(db.calls[0].p_mode, "single"); assert.equal(button(harness.render(), "coachDebrief.saving").props.disabled, true);
    pending.resolve(ok()); await flush(); assert.deepEqual(navigation, ["/coach/groups/group/planning/created"]);
    assert.equal(button(harness.render(), "coach.form.create").props.disabled, true);
  } finally { harness.cleanup(); }
});

test("unknown creation outcome freezes the draft and retries the identical key and payload without duplicate notifications", async () => {
  let notifications = 0, tries = 0;
  const db = database(async () => { if (++tries === 1) throw new Error("network detail"); return ok(true); });
  const { harness, navigation } = await init(db, async () => { notifications++; });
  try {
    button(harness.render(), "coach.form.create").props.onClick(); await flush();
    assert.ok(textContent(harness.render()).includes(messages.fr["coach.error.creationUncertain"]));
    assert.ok(elements(harness.render()).filter(node => node.type === "input").every(node => node.props.disabled));
    for (const locale of ["en", "de", "it", "fr"] as const) { harness.setLocale(locale); assert.ok(textContent(harness.render()).includes(messages[locale]["coach.error.creationUncertain"])); }
    button(harness.render(), "coach.editor.resolveCreation").props.onClick(); await flush();
    assert.deepEqual(db.calls[0], db.calls[1]); assert.equal(notifications, 0); assert.deepEqual(navigation, []);
    assert.ok(textContent(harness.render()).includes(messages.fr["coach.error.creationRecovered"]));
    assert.equal(button(harness.render(), "coach.form.create").props.disabled, true);
  } finally { harness.cleanup(); }
});

test("known rejection preserves the draft and permits a corrected request with a new key", async () => {
  let tries = 0; const db = database(async () => ++tries === 1 ? { data: null, error: { message: "invalid_assignments" } } : ok());
  const { harness } = await init(db);
  try {
    place(harness.render()).props.onChange({ target: { value: "Draft location" } });
    button(harness.render(), "coach.form.create").props.onClick(); await flush();
    assert.equal(place(harness.render()).props.value, "Draft location"); assert.equal(place(harness.render()).props.disabled, false);
    button(harness.render(), "coach.form.create").props.onClick(); await flush();
    assert.notEqual(db.calls[0].p_request_id, db.calls[1].p_request_id); assert.deepEqual(db.calls[0].p_template, db.calls[1].p_template);
  } finally { harness.cleanup(); }
});

test("notification failure after confirmed creation does not permit duplicate activities", async () => {
  const db = database(async () => ok()), { harness, navigation } = await init(db, async () => { throw new Error("notification detail"); });
  try {
    button(harness.render(), "coach.form.create").props.onClick(); await flush();
    assert.ok(textContent(harness.render()).includes(messages.fr["coach.error.planningNotification"]));
    button(harness.render(), "coach.form.create").props.onClick(); await flush(); assert.equal(db.calls.length, 1); assert.deepEqual(navigation, []);
    assert.ok(elements(harness.render()).some(node => node.type === "a" && node.props.href === "/coach/groups/group/planning/created"));
  } finally { harness.cleanup(); }
});

test("a denied or partially loaded roster never offers activity creation", async () => {
  for (const options of [{ permission: false }, { failTable: "profiles" }, { failTable: "coach_group_players" }]) {
    const db = database(async () => ok(), options), { harness } = await init(db);
    try { assert.ok(!elements(harness.render()).some(node => node.type === "button" && textContent(node) === messages.fr["coach.form.create"])); assert.equal(db.calls.length, 0); }
    finally { harness.cleanup(); }
  }
});

test("planning roster paginates large groups, includes only active role-correct defaults and minimizes handicap reads", async () => {
  const db = database(async () => ok(), { count: 1003 });
  const roster = await loadCoachPlanningRoster(db as unknown as SupabaseClient, "group", "coach");
  assert.equal(roster.players.length, 1003); assert.equal(roster.members.length, 1005); assert.deepEqual(roster.coaches.map(row => row.id), ["coach"]);
  assert.ok(db.reads.filter(row => row.table === "profiles").every(row => row.ids.length <= 150));
  assert.ok(db.reads.filter(row => row.select === "id,handicap").every(row => !row.ids.includes("coach") && !row.ids.includes("guest")));
});

test("series creation sends the full recurrence template and changing locale does not reload the draft", async () => {
  const db = database(async () => ok()), { harness } = await init(db);
  try {
    find(harness.render(), node => node.type === "select" && node.props.value === "single").props.onChange({ target: { value: "series" } });
    place(harness.render()).props.onChange({ target: { value: "Series draft" } }); const reads = db.reads.length;
    harness.setLocale("de"); harness.render(); harness.setLocale("fr");
    assert.equal(place(harness.render()).props.value, "Series draft"); assert.equal(db.reads.length, reads);
    button(harness.render(), "coach.form.createSeries").props.onClick(); await flush();
    assert.equal(db.calls[0].p_mode, "series"); const template = db.calls[0].p_template as Record<string, unknown>;
    assert.equal(template.location_text, "Series draft"); assert.equal(template.interval_weeks, 1); assert.ok(template.start_date); assert.ok(template.end_date);
  } finally { harness.cleanup(); }
});

test("creation follows Manager section order with semantic headings, labelled recurrence and a planning return", async () => {
  const { harness } = await init(database(async () => ok()));
  try {
    for (const locale of ["fr", "en", "de", "it"] as const) {
      harness.setLocale(locale);
      const tree = harness.render(), nodes = elements(tree);
      assert.equal(nodes.filter(node => node.type === "h1").length, 1);
      assert.deepEqual(nodes.filter(node => node.type === "h2").map(textContent).map(value => value.trim()),
        ["information", "structure", "coaches", "players", "guests"].map(key => messages[locale][`coach.form.${key}`]));
      const recurrence = find(tree, node => node.type === "label" && textContent(node).includes(messages[locale]["coach.form.recurrence"]));
      assert.ok(elements(recurrence).some(node => node.type === "select" && node.props.value === "single"));
      assert.ok(nodes.some(node => node.type === "a" && node.props.href === "/coach/groups/group/planning" && textContent(node).includes(messages[locale]["coach.form.backPlanning"])));
      assert.ok(nodes.some(node => node.type === "nav" && node.props["aria-label"] === messages[locale]["common.breadcrumb"]));
    }
  } finally { harness.cleanup(); }
});
