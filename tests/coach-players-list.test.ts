import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";
import { coachDateLocale } from "../lib/i18n/coachMessages.ts";

const page = "app/coach/players/page.tsx";
type Query = { table: string; filters: Record<string, unknown> };
const profiles = [
  { id: "assigned", first_name: "Alex", last_name: "Martin", avatar_url: "/avatar.jpg", handicap: 14.2, sex: "male" },
  { id: "transfer", first_name: "Camille", last_name: "Durand", avatar_url: null, handicap: 0, sex: "female" },
  { id: "missing", first_name: "Sam", last_name: "Dupont", avatar_url: null, handicap: null, sex: null },
  { id: "outside", first_name: "Hors", last_name: "Périmètre", avatar_url: null, handicap: 12, sex: "male" },
];

function database(options: { empty?: boolean; fail?: () => boolean } = {}) {
  const reads: Query[] = [];
  return { reads, from(table: string) {
    const state: Query = { table, filters: {} };
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { state.filters[key] = value; return query; },
      in(key: string, value: unknown) { state.filters[key] = value; return query; },
      then(resolve: (result: { data: unknown; error: unknown }) => unknown) {
        reads.push(state);
        if (options.fail?.()) return Promise.resolve({ data: null, error: { message: "private database detail" } }).then(resolve);
        let data: unknown = [];
        if (table === "club_members") data = state.filters.role === "coach" ? (options.empty ? [] : [
          { club_id: "club-a", can_transfer_players_between_club_groups: false },
          { club_id: "club-b", can_transfer_players_between_club_groups: true },
        ]) : [
          { club_id: "club-a", user_id: "assigned" },
          { club_id: "club-b", user_id: "assigned" },
          { club_id: "club-b", user_id: "transfer" },
          { club_id: "club-a", user_id: "missing" },
          { club_id: "club-a", user_id: "outside" },
        ];
        if (table === "clubs") data = [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }];
        if (table === "coach_group_coaches") data = [{ group_id: "group" }];
        if (table === "coach_group_players") data = [{ player_user_id: "assigned" }, { player_user_id: "missing" }];
        if (table === "profiles") data = profiles.filter((profile) => (state.filters.id as string[]).includes(profile.id));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  } };
}
const find = (tree: Element, predicate: (node: Element) => boolean) => {
  const node = elements(tree).find(predicate); assert.ok(node, "Expected UI element"); return node;
};
const rows = (tree: Element) => elements(tree).filter((node) => node.type === "li");
const compactText = (tree: Element) => textContent(tree).replace(/\s+/g, " ").trim();
const noFetch = async () => { throw new Error("Unexpected network request"); };

test("Coach junior rows contain only an avatar, name, parenthesized handicap and accessible eye link", async (context) => {
  const db = database();
  const harness = coachComponentHarness(page, { database: db, fetch: noFetch });
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
  assert.deepEqual(db.reads.find((query) => query.table === "profiles")?.filters.id, ["assigned", "transfer", "missing"]);
  assert.ok(db.reads.filter((query) => query.table === "club_members").every((query) => query.filters.is_active === true));
});

test("the compact list retains name/club search and club/gender filters without refetching", async (context) => {
  const db = database();
  const harness = coachComponentHarness(page, { database: db, fetch: noFetch });
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
  const harness = coachComponentHarness(page, { database: database({ fail: () => fail }), fetch: noFetch });
  const empty = coachComponentHarness(page, { database: database({ empty: true }), fetch: noFetch });
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
