/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated component and route fixtures. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coachComponentHarness, deferred, elements, flush, textContent } from "./helpers/coachComponentHarness.ts";
import { loadManagerModule, managerDatabase, managerFixture } from "./helpers/managerRouteHarness.ts";
import { managerCalendarTranslations } from "../lib/i18n/managerCalendarMessages.ts";
import { managerScopedHref, isManagerClubScopedRoute } from "../lib/managerNavigationContext.ts";
import { requestManagerClubChange } from "../components/manager/useManagerClubChangeGuard.ts";

test("Manager navigation keeps the selected club on scoped destinations", () => {
  for (const route of ["/manager/user-management/players", "/manager/user-management/coaches", "/manager/user-management/managers", "/manager/user-management/custom-fields", "/manager/user-management/seasons", "/manager/user-management/email-configuration", "/manager/training-volume", "/manager/ai-assistance", "/manager/evaluation-criteria", "/manager/groups", "/manager/access", "/manager/performance/juniors", "/manager/performance/coaches", "/manager/om", "/manager/news"]) {
    assert.equal(isManagerClubScopedRoute(route), true);
    assert.equal(managerScopedHref(route, "club A"), `${route}?club=club%20A`);
  }
  assert.equal(managerScopedHref("/manager/news", "club A"), "/manager/news?club=club%20A");
  assert.equal(managerScopedHref("/manager/groups/new", "club A"), "/manager/groups/new?organizationId=club%20A");
  assert.equal(managerScopedHref("/manager/user-management/players", ""), "/manager/user-management/players");
});

const routePath = "app/api/manager/events/calendar/route.ts";
const req = (from = "2026-10-01T00:00:00.000Z", to = "2026-10-31T23:59:59.999Z", token = true) => new Request(`http://localhost/api/manager/events/calendar?${new URLSearchParams({ from, to })}`, { headers: token ? { authorization: "Bearer test" } : {} });
const event = (id: string, starts_at: string, patch = {}) => ({ id, club_id: "A", group_id: "group-A", starts_at, ends_at: null, status: "scheduled", ...patch });

test("calendar paginates over 1000 events and attendees, batches profiles, and isolates managed clubs", async () => {
  const tables = managerFixture();
  tables.club_events = Array.from({ length: 1101 }, (_, n) => event(`event-${n}`, "2026-10-10T10:00:00.000Z"));
  tables.club_events.push(event("overlap", "2026-09-29T10:00:00.000Z", { ends_at: "2026-10-02T18:00:00.000Z" }), event("old", "2026-09-29T10:00:00.000Z"), event("future", "2026-11-10T10:00:00.000Z"), event("outside", "2026-10-10T10:00:00.000Z", { club_id: "B" }));
  tables.club_event_attendees = Array.from({ length: 1101 }, (_, n) => ({ event_id: "event-0", player_id: `junior-${n}` }));
  tables.club_event_attendees.push({ event_id: "outside", player_id: "outside" });
  tables.club_event_coaches = Array.from({ length: 1101 }, (_, n) => ({ event_id: `event-${n}`, coach_id: "target" }));
  tables.profiles.push(...Array.from({ length: 1101 }, (_, n) => ({ id: `junior-${n}`, first_name: `Junior ${n}`, last_name: "Test" })));
  const fixture = managerDatabase(tables, { maxRows: 1000 });
  const response = await loadManagerModule(routePath, fixture.mocks).GET(req());
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.events.length, 1102);
  assert.ok(json.events.some((row: any) => row.id === "overlap"));
  assert.ok(json.events.every((row: any) => !["old", "future", "outside"].includes(row.id)));
  assert.equal(json.attendees.length, 1101);
  assert.equal(json.event_coaches.length, 1101);
  assert.equal(json.event_coaches.at(-1).coach_name, "Coach");
  assert.equal(json.players.find((row: any) => row.id === "junior-1100").name, "Junior 1100 Test");
  assert.ok(!json.players.some((row: any) => row.id === "outside"));
  assert.equal(json.stats.total, 1104, "global counts include events outside the visible month");
  assert.equal(json.stats.completed + json.stats.planned, json.stats.total);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(fixture.writes.length, 0);
});

test("calendar rejects unauthenticated and invalid windows and never returns partial data on a query error", async () => {
  const fixture = managerDatabase(managerFixture());
  const route = loadManagerModule(routePath, fixture.mocks);
  assert.equal((await route.GET(req(undefined, undefined, false))).status, 401);
  for (const [from, to] of [["invalid", "2026-10-31"], ["2026-11-01", "2026-10-01"], ["2020-01-01", "2026-10-01"]]) {
    assert.equal((await route.GET(req(from, to))).status, 400);
  }
  const tables = managerFixture(); tables.club_events = [event("one", "2026-10-10T10:00:00.000Z")];
  const broken = managerDatabase(tables, { failureTable: "club_event_attendees" });
  const failed = await loadManagerModule(routePath, broken.mocks).GET(req());
  assert.equal(failed.status, 500); assert.deepEqual(await failed.json(), { error: "Database failure" });
  tables.club_members = tables.club_members.filter((row) => row.role !== "manager");
  const noAccess = await loadManagerModule(routePath, managerDatabase(tables).mocks).GET(req());
  assert.deepEqual((await noAccess.json()).events, []);
});

function navigation(path = "/manager/performance/coaches", query = "") {
  let params = new URLSearchParams(query);
  const replacements: string[] = [];
  return {
    replacements,
    setQuery(value: string) { params = new URLSearchParams(value); },
    module: { useSearchParams: () => params, usePathname: () => path, useRouter: () => ({ replace: (url: string) => { replacements.push(url); params = new URL(url, "http://local").searchParams; } }) },
  };
}
const seasons = (id: string) => ({ seasons: [{ id: `season-${id}`, name: id, is_current: true, starts_on: "2026-01-01", ends_on: "2026-12-31" }] });

test("switching club discards a stale season response and preserves the selected club in the URL", async () => {
  const nav = navigation(undefined, "tab=coverage&season=season-A");
  const old = deferred<Response>();
  const urls: string[] = [];
  const harness = coachComponentHarness("components/manager/usePerformanceContext.ts", {
    exportName: "usePerformanceContext", modules: { "next/navigation": nav.module },
    fetch: async (url) => { urls.push(String(url)); if (url === "/api/manager/my-clubs") return Response.json({ clubs: [{ id: "A", name: "A" }, { id: "B", name: "B" }] }); return String(url).includes("/A/") ? old.promise : Response.json(seasons("B")); },
  });
  harness.render(); await flush();
  let context: any = harness.render(); await flush();
  assert.equal(context.clubId, "A"); assert.equal(context.seasonId, "");
  context.setClubId("B"); context = harness.render(); await flush(); context = harness.render();
  assert.equal(context.clubId, "B"); assert.equal(context.seasonId, "season-B");
  assert.equal(nav.replacements.at(-1), "/manager/performance/coaches?tab=coverage&club=B");
  old.resolve(Response.json(seasons("A"))); await flush();
  context = harness.render(); assert.equal(context.seasonId, "season-B");
  context.setSeasonId("season-B"); assert.match(nav.replacements.at(-1)!, /club=B&season=season-B/);
  nav.setQuery("club=unmanaged"); context = harness.render(); await flush();
  assert.equal(context.clubId, ""); assert.equal(context.seasonId, ""); assert.ok(context.error);
  assert.ok(urls.every((url) => !url.includes("unmanaged")));
  harness.cleanup();
});

test("a club with no season finishes loading and an invalid season cannot request another club's data", async () => {
  const nav = navigation(undefined, "club=A&season=unknown");
  const harness = coachComponentHarness("components/manager/usePerformanceContext.ts", {
    exportName: "usePerformanceContext", modules: { "next/navigation": nav.module },
    fetch: async (url) => Response.json(url === "/api/manager/my-clubs" ? { clubs: [{ id: "A", name: "A" }] } : { seasons: [] }),
  });
  harness.render(); await flush(); harness.render(); await flush();
  let context: any = harness.render(); assert.equal(context.loading, false); assert.equal(context.seasonId, ""); assert.ok(context.error);
  nav.setQuery("club=A"); context = harness.render(); assert.equal(context.loading, false); assert.equal(context.error, "");
  harness.cleanup();
});

test("calendar requests only the displayed period and ignores an older response after rapid navigation", async () => {
  const requests: Array<{ url: URL; result: ReturnType<typeof deferred<Response>> }> = [];
  const harness = coachComponentHarness("app/manager/calendar/page.tsx", { fetch: async (url) => {
    const result = deferred<Response>(); requests.push({ url: new URL(String(url), "http://local"), result }); return result.promise;
  } });
  let tree = harness.render(); await flush();
  elements(tree).find((node) => node.props["aria-label"] === "Suivant")!.props.onClick();
  tree = harness.render(); await flush();
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ url }) => url.pathname === "/api/manager/events/calendar"));
  assert.ok(requests.every(({ url }) => Date.parse(url.searchParams.get("to")!) - Date.parse(url.searchParams.get("from")!) <= 31 * 86400000 + 3600000));
  assert.ok(requests[1].url.searchParams.get("from")! > requests[0].url.searchParams.get("from")!);
  const base = { groups: [], clubs: [], players: [], attendees: [], event_coaches: [], stats: { completed: 2500, planned: 500, total: 3000 } };
  const starts = new Date(Date.parse(requests[1].url.searchParams.get("from")!) + 86400000).toISOString();
  requests[1].result.resolve(Response.json({ ...base, events: [event("new", starts, { title: "New visible activity" })] })); await flush();
  tree = harness.render(); assert.match(textContent(tree), /New visible activity/); assert.match(textContent(tree), /3000/);
  requests[0].result.resolve(Response.json({ ...base, events: [event("stale", starts, { title: "Wrong month activity" })], stats: { total: 9999 } })); await flush();
  tree = harness.render(); assert.match(textContent(tree), /New visible activity/); assert.doesNotMatch(textContent(tree), /Wrong month activity|9999/);
  elements(tree).find((node) => node.type === "button" && textContent(node) === "Semaine")!.props.onClick();
  tree = harness.render(); await flush();
  assert.equal(elements(tree).find((node) => node.type === "button" && textContent(node) === "Semaine")!.props["aria-pressed"], true);
  assert.ok(Date.parse(requests[2].url.searchParams.get("to")!) - Date.parse(requests[2].url.searchParams.get("from")!) <= 7 * 86400000 + 3600000);
  harness.cleanup();
});

const field = { id: "choice", label: "Transport", field_type: "checkbox", scope: "permanent", options_json: ["Train, puis bus", "Voiture"], applies_to_roles: ["player", "parent", "manager"], visible_to_player: true, editable_by_player: true, visible_to_coach: false, editable_by_coach: false };

test("field editing retains comma-containing options and all recipient roles, and prevents duplicate saves", async () => {
  const writes: Array<{ url: string; body: any }> = []; const save = deferred<Response>(); let reloads = 0;
  const harness = coachComponentHarness("components/manager/PlayerCustomFieldsPage.tsx", { exportName: "FieldEditor", props: { clubId: "B", fields: [field], reload: () => { reloads++; } }, fetch: async (url, init) => { writes.push({ url: String(url), body: JSON.parse(String(init!.body)) }); return save.promise; } });
  let tree = harness.render();
  elements(tree).find((node) => node.props["aria-label"] === "Modifier Transport")!.props.onClick();
  tree = harness.render();
  assert.equal(elements(tree).find((node) => node.type === "textarea")!.props.value, "Train, puis bus\nVoiture");
  const form = elements(tree).find((node) => node.type === "form")!;
  form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); await flush();
  assert.equal(writes.length, 1); assert.equal(writes[0].url, "/api/manager/clubs/B/player-fields/choice");
  assert.deepEqual(writes[0].body.options, field.options_json); assert.deepEqual(writes[0].body.applies_to_roles, field.applies_to_roles);
  save.resolve(Response.json({ ok: true })); await flush(); tree = harness.render();
  assert.equal(reloads, 1); assert.ok(elements(tree).some((node) => node.props.role === "status"));
  harness.cleanup();
});

test("field delete failures are shown without discarding the edited field", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } });
  try {
    let reloads = 0;
    const harness = coachComponentHarness("components/manager/PlayerCustomFieldsPage.tsx", { exportName: "FieldEditor", props: { clubId: "A", fields: [field], reload: () => { reloads++; } }, fetch: async () => Response.json({ error: "Deletion rejected" }, { status: 500 }) });
    let tree = harness.render(); elements(tree).find((node) => node.props["aria-label"] === "Modifier Transport")!.props.onClick(); tree = harness.render();
    elements(tree).find((node) => node.props["aria-label"] === "Supprimer Transport")!.props.onClick(); await flush(); tree = harness.render();
    assert.equal(textContent(elements(tree).find((node) => node.props.role === "alert")), "Deletion rejected");
    assert.equal(elements(tree).find((node) => node.type === "textarea")!.props.value, "Train, puis bus\nVoiture"); assert.equal(reloads, 0);
    harness.cleanup();
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("field actions have explicit accessible names and touch targets in every supported language", () => {
  for (const [locale, edit, remove] of [["fr", "Modifier", "Supprimer"], ["en", "Edit", "Delete"], ["de", "Bearbeiten", "Löschen"], ["it", "Modifica", "Elimina"]] as const) {
    const harness = coachComponentHarness("components/manager/PlayerCustomFieldsPage.tsx", { exportName: "FieldEditor", locale, props: { clubId: "A", fields: [field], reload() {} }, fetch: async () => { throw new Error("No IO expected"); } });
    const tree = harness.render();
    for (const verb of [edit, remove]) {
      const button = elements(tree).find((node) => node.props["aria-label"]?.toLowerCase().includes(verb.toLowerCase()) && node.props["aria-label"]?.includes("Transport"));
      assert.ok(button, `${locale}: ${verb}`); assert.equal(button.props.style.minHeight, 44); assert.equal(button.props.style.minWidth, 44);
    }
    assert.doesNotMatch(textContent(tree), /manager\.fields\./); harness.cleanup();
  }
});

test("the drawer club change respects an open custom-field editor", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let allow = false;
  const browser = Object.assign(new EventTarget(), { confirm: () => allow });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  try {
    const h = coachComponentHarness("components/manager/PlayerCustomFieldsPage.tsx", { exportName: "FieldEditor", props: { clubId: "A", fields: [field], reload() {} }, fetch: async () => { throw Error("No IO expected"); } });
    let tree = h.render();
    assert.equal(requestManagerClubChange(), true);
    elements(tree).find((node) => node.props["aria-label"] === "Modifier Transport")!.props.onClick();
    tree = h.render();
    assert.equal(requestManagerClubChange(), false);
    allow = true;
    assert.equal(requestManagerClubChange(), true);
    elements(tree).find((node) => node.type === "form")!.props.onSubmit({ preventDefault() {} });
    h.render();
    assert.equal(requestManagerClubChange(), false, "a save in progress blocks the club change");
    await flush();
    h.render();
    assert.equal(requestManagerClubChange(), true);
    h.cleanup();
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("all calendar labels provide explicit German and Italian translations", () => {
  const source = readFileSync("app/manager/calendar/page.tsx", "utf8");
  const pairs = [...source.matchAll(/(?:\btr\(|managerCalendarText\([^,]+,\s*)"[^"]*",\s*"([^"]*)"/g)];
  assert.ok(pairs.length > 50);
  for (const [, english] of pairs) assert.equal(managerCalendarTranslations[english]?.filter(Boolean).length, 2, english);
});

for (const [component, endpoint, kpi] of [["ManagerCoachPerformancePage", "coaches", "Coachs actifs"], ["ManagerJuniorPerformancePage", "juniors", "Juniors actifs"]]) {
  test(`${endpoint} statistics reset the group and season on club change without displaying late data`, async () => {
    const nav = navigation(`/manager/performance/${endpoint}`); const late = deferred<Response>(); const urls: URL[] = [];
    const data = (count: number) => ({ filters: { groups: [{ id: "group-A", name: "Group A" }], ftem: [], activityTypes: [] }, overview: { activeCoaches: count, activeJuniors: count, activities: 0, activityHours: 0, coachHours: 0, medianPlayers: null, coverageRate: null, evaluationCompletionRate: null, pendingAttendance: 0, attendanceRate: null, medianActivities: null, medianTrainingMinutes: null, progressing: 0, evaluationCoverage: null, competitionParticipation: null, dataCompleteness: null }, rows: [] });
    const harness = coachComponentHarness(`components/manager/${component}.tsx`, { modules: { "next/navigation": nav.module, recharts: new Proxy({}, { get: (_, name) => String(name) }) }, fetch: async (url) => {
      if (url === "/api/manager/my-clubs") return Response.json({ clubs: [{ id: "A", name: "A" }, { id: "B", name: "B" }] });
      if (String(url).endsWith("/seasons")) return Response.json(seasons(String(url).includes("/A/") ? "A" : "B"));
      const parsed = new URL(String(url), "http://local"); urls.push(parsed);
      if (parsed.searchParams.get("group") === "group-A") return late.promise;
      return Response.json(data(parsed.pathname.includes("/A/") ? 12 : 34));
    } });
    harness.render(); await flush(); harness.render(); await flush(); harness.render(); await flush();
    let tree = harness.render(); assert.equal(elements(tree).find((node) => node.props.label === kpi)!.props.value, "12");
    const groupLabel = elements(tree).find((node) => node.type === "label" && textContent(node).startsWith("Groupe"))!;
    elements(groupLabel).find((node) => node.type === "select")!.props.onChange({ target: { value: "group-A" } }); harness.render(); await flush();
    elements(tree).find((node) => node.props.clubs)!.props.onChange("B");
    tree = harness.render(); assert.ok(!elements(tree).some((node) => node.props.label === kpi)); await flush(); harness.render(); await flush(); tree = harness.render();
    assert.equal(elements(tree).find((node) => node.props.label === kpi)!.props.value, "34");
    assert.equal(urls.at(-1)!.searchParams.get("season"), "season-B"); assert.equal(urls.at(-1)!.searchParams.get("group"), "all");
    late.resolve(Response.json(data(9999))); await flush(); tree = harness.render();
    assert.equal(elements(tree).find((node) => node.props.label === kpi)!.props.value, "34"); harness.cleanup();
  });
}

test("a failed field-list refresh retains the editor and reports the failure", async () => {
  const nav = navigation("/manager/user-management/custom-fields"); let reads = 0;
  const harness = coachComponentHarness("components/manager/PlayerCustomFieldsPage.tsx", { modules: { "next/navigation": nav.module }, fetch: async (url) => {
    if (url === "/api/manager/my-clubs") return Response.json({ clubs: [{ id: "A", name: "A" }] });
    return ++reads === 1 ? Response.json({ playerFields: [field] }) : Response.json({ error: "Temporary outage" }, { status: 500 });
  } });
  harness.render(); await flush(); harness.render(); await flush(); let tree = harness.render();
  elements(tree).find((node) => node.props.fields)!.props.reload(); harness.render(); await flush(); tree = harness.render();
  assert.equal(elements(tree).find((node) => node.props.fields)!.props.fields[0].id, "choice");
  assert.equal(textContent(elements(tree).find((node) => node.props.role === "alert")), "Temporary outage"); harness.cleanup();
});

test("custom fields preserve a draft until club change is confirmed and block changes during save", async () => {
  const nav = navigation("/manager/user-management/custom-fields");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let confirmResult = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => confirmResult } });
  try {
    const harness = coachComponentHarness("components/manager/PlayerCustomFieldsPage.tsx", {
      modules: { "next/navigation": nav.module },
      fetch: async (url) => Response.json(url === "/api/manager/my-clubs"
        ? { clubs: [{ id: "A", name: "A" }, { id: "B", name: "B" }] }
        : { playerFields: [field] }),
    });
    harness.render(); await flush(); harness.render(); await flush();
    let tree = harness.render();
    const editor = elements(tree).find((node) => node.props.editorRef)!;
    let dirty = true, busy = false;
    editor.props.editorRef.current = { hasUnsavedChanges: () => dirty, isBusy: () => busy };
    const select = () => elements(tree).find((node) => node.props.clubs)!;
    select().props.onChange("B");
    assert.equal(nav.replacements.length, 0);
    busy = true; confirmResult = true;
    select().props.onChange("B");
    assert.equal(nav.replacements.length, 0);
    busy = false;
    select().props.onChange("B");
    assert.equal(nav.replacements.at(-1), "/manager/user-management/custom-fields?club=B");
    tree = harness.render();
    assert.ok(!elements(tree).some((node) => node.props.fields));
    await flush(); tree = harness.render();
    assert.equal(elements(tree).find((node) => node.props.fields)!.props.clubId, "B");
    dirty = false;
    harness.cleanup();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
