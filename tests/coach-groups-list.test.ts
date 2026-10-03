import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";

const page = "app/coach/groups/page.tsx";
type Query = { table: string; columns: string; filters: Record<string, unknown> };
const group = (id: string, name: string, is_active = true) => ({ id, name, is_active, club_id: "club", head_coach_user_id: null });
const groups = [group("active", "Junior 1"), group("inactive", "Groupe inactif", false),
  group("specific", "Groupe spécifique"), group("event", "__EVENT_SPECIFIQUE__123"),
  group("archived", "__ARCHIVE_DELETED__123"), group("other", "Autre groupe")];

function database(options: { transfer?: boolean; empty?: boolean; fail?: () => boolean } = {}) {
  const reads: Query[] = [];
  return { reads, from(table: string) {
    const state: Query = { table, columns: "", filters: {} };
    const query = {
      select(columns: string) { state.columns = columns; return query; },
      eq(key: string, value: unknown) { state.filters[key] = value; return query; },
      in(key: string, value: unknown) { state.filters[key] = value; return query; },
      then(resolve: (result: { data: unknown; error: unknown }) => unknown) {
        reads.push(state);
        if (options.fail?.()) return Promise.resolve({ data: null, error: { message: "private database detail" } }).then(resolve);
        let data: unknown = [];
        if (table === "club_members") data = options.empty ? [] : [{ club_id: "club", can_transfer_players_between_club_groups: options.transfer ?? false }];
        if (table === "coach_groups") data = state.columns === "id" ? [] : groups;
        if (table === "clubs") data = [{ id: "club", name: "Club témoin" }];
        if (table === "coach_group_coaches") data = state.columns === "group_id,is_head" ?
          groups.filter((row) => row.id !== "other").map((row) => ({ group_id: row.id, is_head: row.id === "active" })) : [{ group_id: "active" }];
        if (table === "coach_group_players") data = [{ group_id: "active" }, { group_id: "active" }];
        if (table === "coach_group_categories") data = [{ group_id: "active", category: "U14" }];
        assert.notEqual(table, "club_events", "The simplified directory must not fetch activity data");
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  } };
}
const find = (tree: Element, predicate: (node: Element) => boolean) => {
  const node = elements(tree).find(predicate); assert.ok(node, "Expected UI element"); return node;
};
const noFetch = async () => { throw new Error("Unexpected network request"); };

test("Coach groups show only active authorized groups with five columns and an accessible eye link", async (context) => {
  const db = database();
  const harness = coachComponentHarness(page, { database: db, fetch: noFetch });
  context.after(() => harness.cleanup());
  assert.ok(elements(harness.render()).some((node) => node.type === "skeleton"));
  await flush();
  for (const locale of ["fr", "en", "de", "it"] as const) {
    harness.setLocale(locale);
    const tree = harness.render();
    assert.deepEqual(elements(tree).filter((node) => node.type === "th").map(textContent), [
      "coach.groups.group", "coach.directory.club", "coach.nav.players", "coach.groups.coaches", "coach.directory.actions",
    ].map((key) => messages[locale][key]));
    const body = find(tree, (node) => node.type === "tbody");
    const rows = elements(body).filter((node) => node.type === "tr");
    assert.equal(rows.length, 1);
    assert.ok(textContent(rows[0]).includes("Junior 1"));
    assert.ok(textContent(rows[0]).includes("U14"));
    assert.deepEqual(elements(rows[0]).filter((node) => node.type === "td").slice(1, 4).map(textContent), ["Club témoin", "2", "1"]);
    const link = find(rows[0], (node) => node.type === "a");
    assert.equal(link.props.href, "/coach/groups/active");
    assert.equal(link.props["aria-label"], messages[locale]["coach.directory.viewNamed"].replace("{name}", "Junior 1"));
    assert.equal(textContent(link), "");
    assert.ok(elements(link).some((node) => node.type === "Eye" && node.props["aria-hidden"] === "true"));
    assert.ok(!elements(tree).some((node) => node.type === "ArrowRight"));
  }
  const groupRead = db.reads.find((query) => query.table === "coach_groups" && query.columns !== "id");
  assert.equal(groupRead?.filters.is_active, true);
  assert.deepEqual(groupRead.filters.club_id, ["club"]);
  assert.deepEqual(db.reads.find((query) => query.table === "coach_group_players")?.filters.group_id, ["active"]);
  assert.ok(!db.reads.some((query) => query.table === "club_events"));
});

test("group search and transfer-club visibility keep inactive and special groups hidden", async (context) => {
  const db = database({ transfer: true });
  const harness = coachComponentHarness(page, { database: db, fetch: noFetch });
  context.after(() => harness.cleanup());
  harness.render(); await flush();
  let tree = harness.render();
  assert.equal(elements(find(tree, (node) => node.type === "tbody")).filter((node) => node.type === "tr").length, 2);
  assert.ok(textContent(tree).includes("Autre groupe"));
  const readCount = db.reads.length;
  find(tree, (node) => node.type === "input").props.onChange({ target: { value: "U14" } });
  tree = harness.render();
  assert.ok(textContent(tree).includes("Junior 1"));
  assert.ok(!textContent(tree).includes("Autre groupe"));
  find(tree, (node) => node.type === "input").props.onChange({ target: { value: "inactif" } });
  tree = harness.render();
  assert.ok(!elements(tree).some((node) => node.type === "table"));
  assert.ok(textContent(tree).includes(messages.fr["coach.groups.empty"]));
  assert.equal(db.reads.length, readCount);
});

test("empty memberships and failed group reads never show stale table data", async (context) => {
  let fail = true;
  const harness = coachComponentHarness(page, { database: database({ fail: () => fail }), fetch: noFetch });
  const empty = coachComponentHarness(page, { database: database({ empty: true }), fetch: noFetch });
  context.after(() => { harness.cleanup(); empty.cleanup(); });
  harness.render(); empty.render(); await flush();
  assert.ok(textContent(empty.render()).includes(messages.fr["coach.groups.empty"]));
  const failedTree = harness.render();
  assert.ok(textContent(failedTree).includes(messages.fr["coach.error.load"]));
  assert.ok(!textContent(failedTree).includes("private database detail"));
  assert.ok(!elements(failedTree).some((node) => node.type === "table"));
  fail = false;
  find(failedTree, (node) => node.type === "button" && textContent(node) === messages.fr["coach.retry"]).props.onClick();
  harness.render(); await flush();
  assert.ok(textContent(harness.render()).includes("Junior 1"));
});
