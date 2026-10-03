import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";

function find(tree: Element, predicate: (element: Element) => boolean) {
  const result = elements(tree).find(predicate);
  assert.ok(result, "Expected UI control was not rendered");
  return result;
}
const click = (element: Element) => element.props.onClick({ stopPropagation() {} });
const button = (tree: Element, label: string) => find(tree, (node) => node.type === "button" && textContent(node) === label);
const dialog = (tree: Element) => find(tree, (node) => node.type === "dialog");
const player = { id: "junior", first_name: "Test", last_name: "Junior", avatar_url: null };
const camp = {
  id: "camp", title: "Stage témoin", club_name: "Club témoin", notes: null, head_coach: null,
  available_players: [player],
  player_registrations: [{ player_id: player.id, player, registration_status: "registered", day_status_by_day_index: { "0": "present" } }],
  days: [{ event_id: "event", group_id: "group", day_index: 0, starts_at: "2026-10-07T08:00:00Z", ends_at: "2026-10-07T10:00:00Z",
    location_text: "Club témoin", practical_info: null, participants_count: 1, participants: [player], status: "scheduled" }],
};

test("camp copy switches in all four languages without refetching or resetting a draft", async () => {
  let reads = 0;
  const harness = coachComponentHarness("app/coach/camps/page.tsx", { fetch: async () => { reads++; return Response.json({ camps: [camp] }); } });
  assert.ok(elements(harness.render()).some((node) => node.props.role === "status" && node.props["aria-label"] === messages.fr["coach.camps.loading"]));
  await flush();
  let tree = harness.render();
  click(find(tree, (node) => node.props.title === messages.fr["coach.camps.manage"]));
  tree = harness.render();
  find(tree, (node) => node.type === "select" && node.props.value === "present").props.onChange({ target: { value: "absent" } });
  for (const locale of ["fr", "en", "de", "it"] as const) {
    harness.setLocale(locale);
    tree = harness.render();
    assert.ok(textContent(tree).includes(messages[locale]["coach.camps.registrations"]));
    assert.ok(textContent(tree).includes("Stage témoin"));
    assert.ok(textContent(tree).includes("Test Junior"));
    assert.equal(find(tree, (node) => node.type === "select" && node.props.value === "absent").props.value, "absent");
  }
  assert.equal(reads, 1);
  harness.cleanup();
});

test("Coach camps reuse Player photo cards outside the filter panel and retain day and participant actions", async (context) => {
  let reads = 0;
  const photoCamp = { ...camp, image_url: "/camp-photo.jpg", notes: "<p>Bienvenue au stage.</p>",
    head_coach: { id: "head", first_name: "Alex", last_name: "Martin", avatar_url: "/coach-avatar.jpg" },
    days: [{ ...camp.days[0], event_id: "second", day_index: 1 }, camp.days[0],
      { ...camp.days[0], event_id: "undated", day_index: 2, starts_at: null, ends_at: null }],
  };
  const harness = coachComponentHarness("app/coach/camps/page.tsx", {
    fetch: async (_url, init) => {
      assert.equal(init?.method, undefined, "Presentation and disclosure must not write registrations");
      reads++; return Response.json({ coachClubCount: 2, camps: [photoCamp, { ...camp, id: "no-photo", title: "Sans photo", image_url: null }] });
    },
    modules: {
      "@/app/player/camps/PlayerCamps.module.css": { default: { list: "player-camp-list", campCard: "player-camp-card", hero: "player-camp-hero" } },
      "@/app/manager/camps/Camps.module.css": { default: { panel: "filter-panel" } },
      "./CoachActivityCard.module.css": { default: { card: "activity-card", listItem: "activity-list-item" } },
      "@/components/coach/CoachActivityCard.module.css": { default: { card: "activity-card", listItem: "activity-list-item" } },
    },
  });
  context.after(() => harness.cleanup());
  harness.render(); await flush();
  let tree = harness.render();
  const list = find(tree, (node) => node.type === "section" && node.props["aria-labelledby"] === "coach-camps-list-title");
  assert.equal(list.props.className, "player-camp-list");
  assert.ok(!elements(tree).some((node) => node.props["aria-label"] === messages.fr["coach.camps.statistics"]));
  assert.ok(!textContent(tree).includes(messages.fr["coach.camps.registeredPlayers"]));
  const filterPanel = find(tree, (node) => node.props.className === "filter-panel");
  assert.ok(!elements(filterPanel).some((node) => node.type === "article"));
  assert.equal(elements(filterPanel).filter((node) => node.type === "select").length, 2);
  const cards = elements(list).filter((node) => node.type === "article");
  assert.equal(cards.length, 2);
  assert.ok(cards.every((node) => node.props.className.includes("player-camp-card")));
  const hero = find(cards[0], (node) => node.props.className === "player-camp-hero");
  assert.equal(find(hero, (node) => node.type === "img").props.src, photoCamp.image_url);
  assert.equal(find(hero, (node) => node.type === "img").props.alt, camp.title);
  assert.ok(elements(cards[1]).some((node) => node.type === "TentTree"));
  assert.ok(elements(cards[0]).some((node) => node.type === "img" && node.props.src === "/coach-avatar.jpg"));
  assert.ok(elements(cards[0]).some((node) => node.props.dangerouslySetInnerHTML?.__html.includes("Bienvenue au stage")));
  assert.equal(find(tree, (node) => node.props.id === "camp-days-camp").props.hidden, true);
  click(find(tree, (node) => node.props["aria-controls"] === "camp-days-camp"));
  tree = harness.render();
  assert.equal(find(tree, (node) => node.props["aria-controls"] === "camp-days-camp").props["aria-expanded"], true);
  const days = find(tree, (node) => node.props.id === "camp-days-camp");
  assert.equal(days.props.hidden, false);
  const dayRows = elements(days).filter((node) => node.type === "article");
  assert.equal(dayRows.length, 3);
  assert.ok(dayRows.every((node) => node.props.className.includes("activity-list-item")), "All days, including undated days, use separator rows");
  assert.ok(!elements(days).some((node) => node.props.className === "activity-card"));
  assert.equal(elements(days).filter((node) => node.type === "time").length, 4, "Start and end times remain visible");
  assert.deepEqual(elements(days).filter((node) => node.type === "a").map((node) => node.props.href), [
    "/coach/groups/group/planning/event", "/coach/groups/group/planning/second", "/coach/groups/group/planning/undated",
  ]);
  click(find(days, (node) => node.props["aria-label"] === `${messages.fr["coach.camps.participants"]} — Jour 1`));
  tree = harness.render();
  assert.ok(textContent(dialog(tree)).includes("Test Junior"));
  dialog(tree).props.onClose();
  tree = harness.render();
  click(find(tree, (node) => node.type === "button" && textContent(node).trim() === messages.fr["common.close"]));
  tree = harness.render();
  assert.equal(find(tree, (node) => node.props.id === "camp-days-camp").props.hidden, true);
  find(tree, (node) => node.type === "input").props.onChange({ target: { value: "Sans photo" } });
  tree = harness.render();
  assert.equal(elements(tree).filter((node) => node.type === "article").length, 1);
  assert.ok(!textContent(tree).includes(camp.title));
  assert.equal(reads, 1);
});

test("camp save blocks duplicate submissions and all dismissals, retains a failed draft and sends only changed fields", async () => {
  const pending = deferred<Response>();
  const writes: unknown[] = [];
  const harness = coachComponentHarness("app/coach/camps/page.tsx", { fetch: async (_url, init) => {
    if (init?.method === "PATCH") { writes.push(JSON.parse(String(init.body))); return pending.promise; }
    return Response.json({ camps: [camp] });
  } });
  harness.render(); await flush();
  click(find(harness.render(), (node) => node.props.title === messages.fr["coach.camps.manage"]));
  let tree = harness.render();
  find(tree, (node) => node.type === "select" && node.props.value === "present").props.onChange({ target: { value: "absent" } });
  tree = harness.render();
  const save = button(tree, messages.fr["coach.directory.save"]);
  click(save); click(save);
  await flush();
  tree = harness.render();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { player_registrations: [{ player_id: "junior", day_status_by_day_index: { "0": "absent" } }] });
  assert.ok(elements(dialog(tree)).some((node) => node.type === "fieldset" && node.props.disabled === true));
  dialog(tree).props.onClose();
  assert.ok(dialog(harness.render()));
  pending.resolve(Response.json({ error: "private database detail" }, { status: 500 }));
  await flush();
  tree = harness.render();
  assert.ok(textContent(tree).includes(messages.fr["coach.error.save"]));
  assert.ok(!textContent(tree).includes("private database detail"));
  assert.ok(elements(tree).some((node) => node.type === "select" && node.props.value === "absent"));
  dialog(tree).props.onClose();
  assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
  harness.cleanup();
});

test("camp success refreshes the list and closes the dialog without extra mutations", async () => {
  let writes = 0;
  let reads = 0;
  const harness = coachComponentHarness("app/coach/camps/page.tsx", { fetch: async (_url, init) => {
    if (init?.method === "PATCH") { writes++; return Response.json({ ok: true }); }
    reads++; return Response.json({ camps: [camp] });
  } });
  harness.render(); await flush();
  click(find(harness.render(), (node) => node.props.title === messages.fr["coach.camps.manage"]));
  click(button(harness.render(), messages.fr["coach.directory.save"]));
  await flush();
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
  harness.cleanup();
});

const transferProps = { playerId: "junior", playerName: "Test Junior", sourceGroupId: "source", onTransferred() {} };
const transferData = { sourceGroup: { name: "Groupe témoin" }, destinationGroups: [{ id: "dest", name: "Autre groupe" }], futureSourceEventsCount: 3 };

test("transfer options explain both schedules and unchanged history in every language without changing their actions", async (context) => {
  const writes: unknown[] = [];
  const harness = coachComponentHarness("components/coach/CoachPlayerTransferDialog.tsx", {
    props: transferProps, fetch: async (_url, init) => {
      if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); }
      return Response.json(transferData);
    },
  });
  context.after(() => harness.cleanup());
  for (const action of ["keep", "remove_old", "move"] as const) {
    click(find(harness.render(), (node) => node.props["aria-haspopup"] === "dialog"));
    harness.render(); await flush();
    let tree = harness.render();
    const selected = find(tree, (node) => node.type === "input" && node.props.value === action);
    selected.props.onChange();
    for (const locale of ["fr", "en", "de", "it"] as const) {
      harness.setLocale(locale); tree = harness.render();
      assert.ok(textContent(tree).includes(messages[locale]["coach.transfer.explanation"]));
      assert.ok(textContent(tree).includes(messages[locale]["coach.transfer.unchanged"]));
      assert.ok(textContent(tree).includes(messages[locale]["coach.transfer.future"].replace("{count}", "3")));
      const radios = elements(tree).filter((node) => node.type === "input" && node.props.type === "radio");
      assert.equal(radios.length, 3);
      for (const radio of radios) {
        const key = radio.props.value === "remove_old" ? "remove" : radio.props.value;
        const label = find(tree, (node) => node.props.id === radio.props["aria-labelledby"]);
        const hint = find(tree, (node) => node.props.id === radio.props["aria-describedby"]);
        assert.equal(textContent(label), messages[locale][`coach.transfer.${key}`]);
        assert.equal(textContent(hint), messages[locale][`coach.transfer.${key}Hint`]);
        assert.equal(radio.props.checked, radio.props.value === action);
      }
    }
    click(button(tree, messages.it["coach.transfer.confirm"])); await flush();
    assert.deepEqual(writes.at(-1), { sourceGroupId: "source", destinationGroupId: "dest", futureEventsAction: action });
    assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
  }
  assert.equal(writes.length, 3);
});

test("transfer resets future invitation handling on reopening and ignores stale reads", async () => {
  const stale = deferred<Response>();
  let reads = 0;
  const harness = coachComponentHarness("components/coach/CoachPlayerTransferDialog.tsx", { props: transferProps, fetch: async () => {
    reads++; return reads === 2 ? stale.promise : Response.json(transferData);
  } });
  click(find(harness.render(), (node) => node.props["aria-haspopup"] === "dialog"));
  harness.render(); await flush();
  let tree = harness.render();
  elements(tree).filter((node) => node.type === "input" && node.props.type === "radio")[2].props.onChange();
  dialog(tree).props.onClose(); harness.render();
  click(find(harness.render(), (node) => node.props["aria-haspopup"] === "dialog"));
  tree = harness.render(); await flush();
  dialog(tree).props.onClose(); harness.render();
  click(find(harness.render(), (node) => node.props["aria-haspopup"] === "dialog"));
  harness.render(); await flush();
  stale.resolve(Response.json({ ...transferData, destinationGroups: [{ id: "stale", name: "Stale group" }] }));
  await flush();
  tree = harness.render();
  assert.equal(elements(tree).filter((node) => node.type === "input" && node.props.type === "radio")[0].props.checked, true);
  assert.equal(find(tree, (node) => node.type === "select").props.value, "dest");
  assert.ok(!textContent(tree).includes("Stale group"));
  harness.cleanup();
});

test("transfer cannot close, edit or submit twice while pending, then reports success once", async () => {
  const pending = deferred<Response>();
  let writes = 0; let transferred = 0;
  const harness = coachComponentHarness("components/coach/CoachPlayerTransferDialog.tsx", {
    props: { ...transferProps, onTransferred() { transferred++; } },
    fetch: async (_url, init) => {
      if (init?.method === "POST") { writes++; assert.deepEqual(JSON.parse(String(init.body)), { sourceGroupId: "source", destinationGroupId: "dest", futureEventsAction: "keep" }); return pending.promise; }
      return Response.json(transferData);
    },
  });
  click(find(harness.render(), (node) => node.props["aria-haspopup"] === "dialog"));
  harness.render(); await flush();
  let tree = harness.render();
  const confirm = button(tree, messages.fr["coach.transfer.confirm"]);
  click(confirm); click(confirm); await flush();
  tree = harness.render();
  dialog(tree).props.onClose();
  tree = harness.render();
  assert.ok(dialog(tree));
  assert.ok(elements(tree).some((node) => node.type === "fieldset" && node.props.disabled === true));
  assert.equal(writes, 1);
  pending.resolve(Response.json({ ok: true })); await flush();
  assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
  assert.equal(transferred, 1);
  harness.cleanup();
});

test("transfer errors are localized and an empty destination list cannot be submitted", async () => {
  for (const locale of ["fr", "en", "de", "it"] as const) {
    for (const failed of [true, false]) {
      const harness = coachComponentHarness("components/coach/CoachPlayerTransferDialog.tsx", {
        props: transferProps, locale, fetch: async () => failed ? Response.json({ error: "internal detail" }, { status: 403 }) : Response.json({ ...transferData, destinationGroups: [] }),
      });
      click(find(harness.render(), (node) => node.props["aria-haspopup"] === "dialog"));
      harness.render(); await flush();
      const tree = harness.render();
      assert.ok(textContent(tree).includes(messages[locale][failed ? "coach.error.forbidden" : "coach.transfer.noDestinations"]));
      assert.ok(!textContent(tree).includes("internal detail"));
      assert.equal(button(tree, messages[locale]["coach.transfer.confirm"]).props.disabled, true);
      harness.cleanup();
    }
  }
});

test("directory loading, empty and error states translate without displaying raw database errors", async () => {
  for (const page of ["players", "groups"]) {
    for (const locale of ["fr", "en", "de", "it"] as const) {
      for (const failed of [true, false]) {
        const query = new Proxy({}, { get: (_, property) => property === "then" ?
          (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: failed ? { message: "database detail" } : null }).then(resolve) : () => query });
        const harness = coachComponentHarness("app/coach/" + page + "/page.tsx", {
          locale, database: { from: () => query }, fetch: async () => { throw new Error("Unexpected fetch"); },
        });
        assert.ok(elements(harness.render()).some((node) => node.type === "skeleton"));
        await flush();
        const tree = harness.render();
        assert.ok(textContent(tree).includes(messages[locale][failed ? "coach.error.load" : "coach." + page + ".empty"]));
        assert.ok(!textContent(tree).includes("database detail"));
        harness.cleanup();
      }
    }
  }
});
