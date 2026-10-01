import assert from "node:assert/strict";
import test from "node:test";
import { coachPlanningView, coachPlanningAttendanceKey, coachPlanningTitle, type CoachPlanningData, type CoachPlanningEvent } from "../lib/coachPlanning.ts";
import { messages } from "../lib/i18n/messages.ts";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";

const page = "app/coach/groups/[id]/planning/page.tsx";
const now = Date.parse("2026-10-01T12:00:00Z");
const person = { id: "junior", first_name: "Junior", last_name: "Témoin", avatar_url: null };
const event = (id: string, changes: Partial<CoachPlanningEvent> = {}): CoachPlanningEvent => ({
  id, group_id: "group", club_id: "club", title: id, event_type: "training",
  starts_at: "2026-10-01T08:00:00Z", ends_at: "2026-10-01T09:00:00Z", duration_minutes: 60,
  location_text: "Practice", series_id: "series", status: "scheduled", requires_evaluation: true,
  evaluation_complete: false, coaches: [person],
  attendees: [{ ...person, status: "expected", coach_recorded_status: null, is_player: true }], ...changes,
});
const responseData = (events = [event("future", { starts_at: "2099-01-01T08:00:00Z", ends_at: "2099-01-01T09:00:00Z" })]): CoachPlanningData => ({
  group: { id: "group", name: "Groupe témoin", club_id: "club" }, club_name: "Club témoin", can_plan: true, events,
});
const find = (tree: Element, predicate: (node: Element) => boolean) => {
  const node = elements(tree).find(predicate); assert.ok(node, "Expected UI element"); return node;
};
const button = (tree: Element, label: string) => find(tree, (node) => node.type === "button" && textContent(node) === label);
const dialog = (tree: Element) => find(tree, (node) => node.type === "dialog");
const openDelete = (tree: Element) => find(tree, (node) => node.type === "button" && Boolean(node.props["aria-label"])).props.onClick();
const tabs = (tree: Element) => find(tree, (node) => node.type === "tabs");
const init = async (fetch: typeof globalThis.fetch, dataOptions = {}) => {
  const harness = coachComponentHarness(page, { params: { id: "group" }, fetch, ...dataOptions });
  harness.render(); await flush(); return harness;
};

test("planning and detail titles prefer the saved name and keep localized unnamed fallbacks", () => {
  assert.equal(coachPlanningTitle("  TEST audit Coach  ", "Événement — Groupe"), "TEST audit Coach");
  for (const title of [null, undefined, "", "   "]) {
    assert.equal(coachPlanningTitle(title, "Training — Group"), "Training — Group");
  }
});

test("planning counts use guided completion, real end time, cancellation and the same type filter", () => {
  const events = [event("pending"), event("complete", { evaluation_complete: true }),
    event("ongoing", { starts_at: "2026-10-01T11:30:00Z", ends_at: null, duration_minutes: 90 }),
    event("cancelled", { status: "cancelled" }), event("disabled", { requires_evaluation: false }),
    event("camp", { event_type: "camp" }), event("future", { starts_at: "2026-10-02T08:00:00Z", ends_at: "2026-10-02T09:00:00Z" })];
  const view = coachPlanningView(events, "all", "pending", now);
  assert.deepEqual(view.events.map((row) => row.id), ["pending"]);
  assert.deepEqual(view.counts, { all: 7, upcoming: 2, past: 5, pending: 1 });
  assert.deepEqual(coachPlanningView(events, "camp", "all", now).counts, { all: 1, upcoming: 0, past: 1, pending: 0 });
  assert.equal(coachPlanningView(events, "training", "all", now).counts.all, 6);
});

test("planning never mistakes an invitation or an unrecorded presence for manual attendance", () => {
  assert.equal(coachPlanningAttendanceKey({ status: "expected", coach_recorded_status: null }), "coach.planning.expected");
  assert.equal(coachPlanningAttendanceKey({ status: "present", coach_recorded_status: null }), "coach.planning.registered");
  assert.equal(coachPlanningAttendanceKey({ status: "absent", coach_recorded_status: null }), "coach.planning.unavailable");
  assert.equal(coachPlanningAttendanceKey({ status: "excused", coach_recorded_status: null }), "coach.planning.excused");
  assert.equal(coachPlanningAttendanceKey({ status: "expected", coach_recorded_status: "present" }), "coach.camps.present");
  assert.equal(coachPlanningAttendanceKey({ status: "present", coach_recorded_status: "absent" }), "coach.camps.absent");
});

test("planning filters and languages preserve the current choice without additional reads or writes", async () => {
  let calls = 0;
  const harness = await init(async () => { calls++; return Response.json(responseData([event("pending", { ends_at: "2000-01-01T09:00:00Z" })])); });
  try {
    tabs(harness.render()).props.onChange("pending");
    let tree = harness.render();
    assert.ok(elements(tree).some((node) => node.type === "a" && node.props.href === "/coach/groups/group/planning/pending/debrief"));
    for (const locale of ["fr", "en", "de", "it"] as const) {
      harness.setLocale(locale); tree = harness.render();
      assert.equal(tabs(tree).props.value, "pending");
      assert.ok(textContent(tree).includes(messages[locale]["coach.planning.expected"]));
      assert.ok(textContent(tree).includes(messages[locale]["coach.planning.evaluate"]));
      assert.ok(textContent(tree).includes("Junior Témoin"));
    }
    find(tree, (node) => node.type === "select").props.onChange({ target: { value: "camp" } });
    tree = harness.render();
    assert.equal(tabs(tree).props.value, "pending");
    assert.ok(tabs(tree).props.items.every((item: { label: string }) => item.label.endsWith("(0)")));
    assert.equal(calls, 1);
  } finally { harness.cleanup(); }
});

test("opening and cancelling deletion performs no write and always resets to one occurrence", async () => {
  let writes = 0;
  const harness = await init(async (_url, init) => { if (init?.method) writes++; return Response.json(responseData()); });
  try {
    openDelete(harness.render());
    let tree = harness.render();
    elements(dialog(tree)).filter((node) => node.type === "input")[1].props.onChange();
    button(harness.render(), messages.fr["coach.directory.cancel"]).props.onClick();
    assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
    openDelete(harness.render()); tree = harness.render();
    assert.equal(elements(dialog(tree)).filter((node) => node.type === "input")[0].props.checked, true);
    dialog(tree).props.onClose();
    assert.equal(writes, 0);
  } finally { harness.cleanup(); }
});

test("default delete targets only the occurrence and blocks duplicate sends and dismissal while pending", async () => {
  const pending = deferred<Response>(); const writes: string[] = []; let reads = 0;
  const harness = await init(async (url, init) => {
    if (init?.method === "DELETE") { writes.push(String(url)); return pending.promise; }
    reads++; return Response.json(responseData());
  });
  try {
    openDelete(harness.render());
    const confirm = button(harness.render(), messages.fr["coach.planning.deleteConfirmOccurrence"]);
    confirm.props.onClick(); confirm.props.onClick(); await flush();
    let tree = harness.render();
    dialog(tree).props.onClose(); tree = harness.render();
    assert.ok(dialog(tree));
    assert.equal(find(dialog(tree), (node) => node.type === "fieldset").props.disabled, true);
    assert.deepEqual(writes, ["/api/coach/events/future?scope=occurrence"]);
    pending.resolve(Response.json({ ok: true })); await flush();
    tree = harness.render();
    assert.ok(!elements(tree).some((node) => node.type === "dialog"));
    assert.ok(textContent(tree).includes(messages.fr["coach.planning.deleted"]));
    assert.equal(reads, 2);
  } finally { harness.cleanup(); }
});

test("whole-series deletion requires an explicit selection that survives a language change", async () => {
  const writes: string[] = [];
  const harness = await init(async (url, init) => {
    if (init?.method === "DELETE") { writes.push(String(url)); return Response.json({ ok: true }); }
    return Response.json(responseData());
  });
  try {
    openDelete(harness.render());
    elements(dialog(harness.render())).filter((node) => node.type === "input")[1].props.onChange();
    harness.setLocale("de");
    const tree = harness.render();
    assert.equal(elements(dialog(tree)).filter((node) => node.type === "input")[1].props.checked, true);
    assert.ok(textContent(tree).includes(messages.de["coach.planning.deleteSeriesHint"]));
    button(tree, messages.de["coach.planning.deleteConfirmSeries"]).props.onClick(); await flush();
    assert.deepEqual(writes, ["/api/coach/events/series/series"]);
  } finally { harness.cleanup(); }
});

test("uncertain deletion keeps its scope, hides raw errors and requires a read refresh before retry", async () => {
  let reads = 0; let writes = 0;
  const harness = await init(async (_url, init) => {
    if (init?.method === "DELETE") { writes++; throw new Error("sensitive network failure"); }
    reads++; return Response.json(responseData());
  });
  try {
    openDelete(harness.render());
    elements(dialog(harness.render())).filter((node) => node.type === "input")[1].props.onChange();
    button(harness.render(), messages.fr["coach.planning.deleteConfirmSeries"]).props.onClick(); await flush();
    let tree = harness.render();
    assert.ok(textContent(tree).includes(messages.fr["coach.error.planningDelete"]));
    assert.ok(!textContent(tree).includes("sensitive"));
    const confirm = button(tree, messages.fr["coach.planning.deleteConfirmSeries"]);
    assert.equal(confirm.props.disabled, true);
    confirm.props.onClick(); await flush(); assert.equal(writes, 1);
    button(tree, messages.fr["coach.planning.refresh"]).props.onClick(); await flush();
    tree = harness.render();
    assert.equal(button(tree, messages.fr["coach.planning.deleteConfirmSeries"]).props.disabled, false);
    assert.equal(reads, 2); assert.equal(writes, 1);
  } finally { harness.cleanup(); }
});

test("successful deletion with failed refresh is not presented as a failed deletion", async () => {
  let reads = 0;
  const harness = await init(async (_url, init) => {
    if (init?.method === "DELETE") return Response.json({ ok: true });
    reads++; return reads === 1 ? Response.json(responseData()) : Response.json({ error: "SQL detail" }, { status: 500 });
  });
  try {
    openDelete(harness.render());
    button(harness.render(), messages.fr["coach.planning.deleteConfirmOccurrence"]).props.onClick(); await flush();
    const tree = harness.render();
    assert.ok(textContent(tree).includes(messages.fr["coach.error.planningRefresh"]));
    assert.ok(!textContent(tree).includes("SQL detail"));
    assert.ok(!elements(tree).some((node) => node.type === "dialog" || node.type === "article"));
    assert.ok(tabs(tree).props.items.every((item: { label: string }) => item.label.endsWith("(—)")));
  } finally { harness.cleanup(); }
});

test("cancelling during a deletion refresh cannot reopen the dialog after its response", async () => {
  const refreshed = deferred<Response>(); let reads = 0; let writes = 0;
  const harness = await init(async (_url, init) => {
    if (init?.method === "DELETE") { writes++; throw new Error("offline"); }
    return ++reads === 1 ? Response.json(responseData()) : refreshed.promise;
  });
  try {
    openDelete(harness.render());
    button(harness.render(), messages.fr["coach.planning.deleteConfirmOccurrence"]).props.onClick(); await flush();
    button(harness.render(), messages.fr["coach.planning.refresh"]).props.onClick(); await flush();
    button(harness.render(), messages.fr["coach.directory.cancel"]).props.onClick();
    assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
    refreshed.resolve(Response.json(responseData())); await flush();
    assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
    assert.equal(writes, 1);
  } finally { harness.cleanup(); }
});

test("a refreshed event cannot silently transfer series deletion approval to a changed series", async () => {
  for (const seriesId of [null, "different-series"]) {
    let reads = 0;
    const harness = await init(async (_url, init) => {
      if (init?.method === "DELETE") throw new Error("offline");
      const data = responseData();
      if (++reads > 1) data.events[0].series_id = seriesId;
      return Response.json(data);
    });
    try {
      openDelete(harness.render());
      elements(dialog(harness.render())).filter((node) => node.type === "input")[1].props.onChange();
      button(harness.render(), messages.fr["coach.planning.deleteConfirmSeries"]).props.onClick(); await flush();
      button(harness.render(), messages.fr["coach.planning.refresh"]).props.onClick(); await flush();
      const tree = harness.render();
      assert.equal(button(tree, messages.fr["coach.planning.deleteConfirmOccurrence"]).props.disabled, false);
      assert.ok(textContent(dialog(tree)).includes(messages.fr["coach.planning.deleteOccurrenceHint"]));
    } finally { harness.cleanup(); }
  }
});

test("planning loading and failures are localized and never look like an empty schedule", async () => {
  for (const locale of ["fr", "en", "de", "it"] as const) {
    const harness = coachComponentHarness(page, { params: { id: "group" }, locale, fetch: async () => Response.json({ error: "private detail" }, { status: 403 }) });
    try {
      assert.ok(elements(harness.render()).some((node) => node.type === "skeleton"));
      await flush();
      const tree = harness.render();
      assert.ok(textContent(tree).includes(messages[locale]["coach.error.forbidden"]));
      assert.ok(!textContent(tree).includes(messages[locale]["coach.planning.emptyUpcoming"]));
      assert.ok(!textContent(tree).includes("private detail"));
      assert.ok(!elements(tree).some((node) => node.type === "a" && String(node.props.href).endsWith("/add")));
    } finally { harness.cleanup(); }
  }
});

test("readonly planning cannot expose mutation controls and more results require no refetch", async () => {
  let reads = 0;
  const data = responseData(Array.from({ length: 51 }, (_, i) => event(`future-${i}`, { starts_at: "2099-01-01T08:00:00Z", ends_at: "2099-01-01T09:00:00Z" })));
  data.can_plan = false;
  const harness = await init(async () => { reads++; return Response.json(data); });
  try {
    let tree = harness.render();
    assert.equal(elements(tree).filter((node) => node.type === "article").length, 50);
    assert.ok(!elements(tree).some((node) => node.type === "button" && node.props["aria-label"]));
    assert.ok(!elements(tree).some((node) => node.type === "a" && /\/(edit|add)$/.test(node.props.href)));
    button(tree, messages.fr["coach.planning.showMore"]).props.onClick(); tree = harness.render();
    assert.equal(elements(tree).filter((node) => node.type === "article").length, 51);
    assert.equal(reads, 1);
  } finally { harness.cleanup(); }
});

test("a stale planning response cannot overwrite the group currently on screen", async () => {
  const old = deferred<Response>(); const params = { id: "old" };
  const harness = coachComponentHarness(page, { params, fetch: async (url) => String(url).includes("/old/") ? old.promise : Response.json(responseData()) });
  try {
    harness.render(); await flush();
    params.id = "group"; harness.render(); await flush();
    assert.ok(textContent(harness.render()).includes("Groupe témoin"));
    old.resolve(Response.json({ ...responseData(), group: { id: "old", name: "Stale group", club_id: "club" } })); await flush();
    assert.ok(!textContent(harness.render()).includes("Stale group"));
  } finally { harness.cleanup(); }
});
