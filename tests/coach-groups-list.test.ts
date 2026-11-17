import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";

const page = "app/coach/groups/page.tsx";
function database(options: { transfer?: boolean; empty?: boolean; fail?: () => boolean } = {}) {
  const reads: string[] = [];
  const active = { id: "active", name: "Junior 1", clubName: "Club témoin", playerCount: 2, coachCount: 1, categories: ["U14"], players: [{ id: "junior", first_name: "Léo", last_name: "Moix", avatar_url: "/leo.jpg" }], coaches: [{ id: "coach", first_name: "Jean-Yves", last_name: "Saubaber", avatar_url: null }], isHead: true, isAssigned: true };
  return { reads, fetch: async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/coach/directory?view=groups");
    assert.equal(init.cache, "no-store");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-only");
    reads.push(url);
    if (options.fail?.()) return Response.json({ error: "private database detail" }, { status: 500 });
    return Response.json({ groups: options.empty ? [] : [active, ...(options.transfer ? [{ ...active, id: "other", name: "Autre groupe", categories: [], isAssigned: false, isHead: false }] : [])] });
  } };
}
const find = (tree: Element, predicate: (node: Element) => boolean) => {
  const node = elements(tree).find(predicate); assert.ok(node, "Expected UI element"); return node;
};


test("Coach groups show only active authorized groups with five columns and an accessible eye link", async (context) => {
  const db = database();
  const harness = coachComponentHarness(page, { fetch: db.fetch });
  context.after(() => harness.cleanup());
  assert.ok(elements(harness.render()).some((node) => node.type === "skeleton"));
  await flush();
  for (const locale of ["fr", "en", "de", "it"] as const) {
    harness.setLocale(locale);
    const tree = harness.render();
    assert.deepEqual(elements(tree).filter((node) => node.type === "th").map(textContent), [
      "coach.groups.group", "organization.context", "coach.nav.players", "coach.groups.coaches", "coach.directory.actions",
    ].map((key) => messages[locale][key]));
    const body = find(tree, (node) => node.type === "tbody");
    const rows = elements(body).filter((node) => node.type === "tr");
    assert.equal(rows.length, 1);
    assert.ok(textContent(rows[0]).includes("Junior 1"));
    assert.ok(textContent(rows[0]).includes("U14"));
    assert.deepEqual(elements(rows[0]).filter((node) => node.type === "td").slice(1, 4).map(node => textContent(node).trim()), ["Club témoin", "Léo Moix", "JS Jean-Yves Saubaber"]);
    const link = find(rows[0], (node) => node.type === "a");
    assert.equal(link.props.href, "/coach/groups/active");
    assert.equal(link.props["aria-label"], messages[locale]["coach.directory.viewNamed"].replace("{name}", "Junior 1"));
    assert.equal(textContent(link), "");
    assert.ok(elements(link).some((node) => node.type === "Eye" && node.props["aria-hidden"] === "true"));
    assert.ok(!elements(tree).some((node) => node.type === "ArrowRight"));
  }
  assert.equal(db.reads.length, 1, "One authenticated request replaces the roster fan-out");
});

test("group search and transfer-club visibility keep inactive and special groups hidden", async (context) => {
  const db = database({ transfer: true });
  const harness = coachComponentHarness(page, { fetch: db.fetch });
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
  const harness = coachComponentHarness(page, { fetch: database({ fail: () => fail }).fetch });
  const empty = coachComponentHarness(page, { fetch: database({ empty: true }).fetch });
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
