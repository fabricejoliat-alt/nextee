import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";
import { coachDateLocale } from "../lib/i18n/coachMessages.ts";

const page = "app/coach/players/page.tsx";
const profiles = [
  { id: "assigned", first_name: "Alex", last_name: "Martin", avatar_url: "/avatar.jpg", handicap: 14.2, sex: "male" },
  { id: "transfer", first_name: "Camille", last_name: "Durand", avatar_url: null, handicap: 0, sex: "female" },
  { id: "missing", first_name: "Sam", last_name: "Dupont", avatar_url: null, handicap: null, sex: null },
  { id: "outside", first_name: "Hors", last_name: "Périmètre", avatar_url: null, handicap: 12, sex: "male" },
];

function database(options: { empty?: boolean; fail?: () => boolean } = {}) {
  const reads: string[] = [];
  return { reads, fetch: async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/coach/directory?view=players");
    assert.equal(init.cache, "no-store");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-only");
    reads.push(url);
    if (options.fail?.()) return Response.json({ error: "private database detail" }, { status: 500 });
    return Response.json({ clubs: options.empty ? [] : [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }],
      players: options.empty ? [] : profiles.slice(0, 3).map((profile, index) => ({ ...profile,
        club_ids: index === 0 ? ["club-a", "club-b"] : index === 1 ? ["club-b"] : ["club-a"],
        club_names: index === 0 ? ["Club A", "Club B"] : index === 1 ? ["Club B"] : ["Club A"],
      })) });
  } };
}
const find = (tree: Element, predicate: (node: Element) => boolean) => {
  const node = elements(tree).find(predicate); assert.ok(node, "Expected UI element"); return node;
};
const rows = (tree: Element) => elements(tree).filter((node) => node.type === "li");
const compactText = (tree: Element) => textContent(tree).replace(/\s+/g, " ").trim();


test("Coach junior rows contain only an avatar, name, parenthesized handicap and accessible eye link", async (context) => {
  const db = database();
  const harness = coachComponentHarness(page, { fetch: db.fetch });
  context.after(() => harness.cleanup());
  assert.ok(elements(harness.render()).some((node) => node.type === "skeleton"));
  await flush();
  for (const locale of ["fr", "en", "de", "it"] as const) {
    harness.setLocale(locale);
    const tree = harness.render();
    assert.equal(rows(tree).length, 3);
    assert.ok(!elements(tree).some((node) => node.type === "table"));
    rows(tree).forEach((row, index) => {
      const profile = profiles[index];
      const fullName = `${profile.first_name} ${profile.last_name}`;
      const handicap = profile.handicap === null ? messages[locale]["coach.directory.noData"] :
        new Intl.NumberFormat(coachDateLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(profile.handicap);
      const identity = find(row, (node) => node.type === "div");
      assert.equal(compactText(identity), `${fullName} ( ${handicap} )`);
      assert.equal(find(identity, (node) => node.type === "span").props["aria-label"], `${messages[locale]["coach.directory.handicap"]} : ${handicap}`);
      assert.ok(!textContent(row).includes("Club"));
      assert.ok(!textContent(row).includes(messages[locale]["coach.directory.male"]));
      const avatar = find(row, (node) => node.type === "span" && node.props["aria-hidden"] === "true");
      if (profile.avatar_url) {
        const image = find(avatar, (node) => node.type === "img");
        assert.equal(image.props.src, profile.avatar_url);
        assert.equal(image.props.alt, "");
      } else assert.equal(compactText(avatar), `${profile.first_name[0]}${profile.last_name[0]}`);
      const link = find(row, (node) => node.type === "a");
      assert.equal(link.props.href, `/coach/players/${profile.id}?returnTo=%2Fcoach%2Fplayers`);
      assert.equal(link.props["aria-label"], messages[locale]["coach.directory.viewNamed"].replace("{name}", fullName));
      assert.ok(elements(link).some((node) => node.type === "Eye" && node.props["aria-hidden"] === "true"));
    });
  }
  assert.equal(db.reads.length, 1, "One authenticated request replaces the roster fan-out");
});

test("the compact list retains name/club search and club/gender filters without refetching", async (context) => {
  const db = database();
  const harness = coachComponentHarness(page, { fetch: db.fetch });
  context.after(() => harness.cleanup());
  harness.render(); await flush();
  let tree = harness.render();
  const readCount = db.reads.length;
  const search = find(tree, (node) => node.type === "input");
  search.props.onChange({ target: { value: "Club B" } });
  tree = harness.render();
  assert.equal(rows(tree).length, 2);
  search.props.onChange({ target: { value: "" } });
  tree = harness.render();
  const filters = elements(tree).filter((node) => node.type === "select");
  filters[0].props.onChange({ target: { value: "club-a" } });
  filters[1].props.onChange({ target: { value: "none" } });
  tree = harness.render();
  assert.equal(rows(tree).length, 1);
  assert.ok(textContent(rows(tree)[0]).includes("Sam Dupont"));
  search.props.onChange({ target: { value: "Introuvable" } });
  tree = harness.render();
  assert.equal(rows(tree).length, 0);
  assert.ok(textContent(tree).includes(messages.fr["coach.players.empty"]));
  assert.equal(db.reads.length, readCount);
});

test("empty memberships and failed directory reads show no junior rows and support retry", async (context) => {
  let fail = true;
  const harness = coachComponentHarness(page, { fetch: database({ fail: () => fail }).fetch });
  const empty = coachComponentHarness(page, { fetch: database({ empty: true }).fetch });
  context.after(() => { harness.cleanup(); empty.cleanup(); });
  harness.render(); empty.render(); await flush();
  assert.ok(textContent(empty.render()).includes(messages.fr["coach.players.empty"]));
  const failedTree = harness.render();
  assert.equal(rows(failedTree).length, 0);
  assert.ok(textContent(failedTree).includes(messages.fr["coach.error.load"]));
  assert.ok(!textContent(failedTree).includes("private database detail"));
  fail = false;
  find(failedTree, (node) => node.type === "button" && textContent(node) === messages.fr["coach.retry"]).props.onClick();
  harness.render(); await flush();
  assert.equal(rows(harness.render()).length, 3);
});
