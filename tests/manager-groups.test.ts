/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated fixtures; no live groups or assignments. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerGroupEntries } from "../lib/i18n/managerGroupMessages.ts";
import { managerGroupFormat } from "../lib/managerGroupPresentation.ts";
import { coachComponentHarness, elements, textContent, flush, deferred } from "./helpers/coachComponentHarness.ts";
import { managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";
const paths = ["components/manager/GroupsManagementPage.tsx", "app/manager/groups/new/page.tsx", "app/manager/groups/[id]/page.tsx"];
const locales: AppLocale[] = ["fr", "en", "de", "it"];
const t = (l: AppLocale) => (key: string) => messages[l][key] ?? key;
const msg = (l: AppLocale, key: string) => t(l)(`manager.groups.${key}`);
function localized() { let locale: AppLocale = "fr"; return { set(l: AppLocale) { locale = l; }, module: { useI18n: () => ({ locale, t: t(locale) }) } }; }
async function settle(h: ReturnType<typeof coachComponentHarness>) { let tree = h.render(); for (let i = 0; i < 5; i++) { await flush(); tree = h.render(); } return tree; }
function field(tree: any, value: string) { const n = elements(tree).find(n => ["input", "select"].includes(n.type) && (n.props["aria-label"] === value || n.props.placeholder === value)); assert.ok(n, value); return n; }
function button(tree: any, value: string) { const n = elements(tree).find(n => n.type === "button" && (textContent(n).trim() === value || n.props["aria-label"] === value)); assert.ok(n, value); return n; }
const ui = (tree: any) => elements(tree).map(n => [textContent(n), n.props.label, n.props.title, n.props["aria-label"], n.props.placeholder].filter(x => typeof x === "string").join(" ")).join(" ");
const event = { preventDefault() {} };
const club = { id: "club", name: "Club maison" };
const season = { id: "season", club_id: "club", name: "Saison maison", is_current: true, starts_on: "2026-01-01", ends_on: "2026-12-31" };
const person = (id: string, name: string) => ({ id, first_name: name, last_name: "Exemple", handicap: 0, avatar_url: null });
function tables(): Record<string, Row[]> { return {
  club_seasons: [season],
  club_members: [ { club_id: "club", user_id: "coach", role: "manager", is_active: true }, ...["zcoach", "acoach", "junior", "second"].map(user_id => ({ club_id: "club", user_id, role: user_id.includes("coach") ? "coach" : "player", is_active: true })) ],
  profiles: [person("zcoach", "Zoé"), person("acoach", "Alex"), person("junior", "Léa"), person("second", "Tom")],
  coach_groups: [{ id: "group", club_id: "club", club_season_id: "season", name: "Groupe {name}", is_active: true, is_performance: false, head_coach_user_id: "zcoach" }],
  coach_group_categories: [{ id: "cat", group_id: "group", category: "Catégorie maison" }],
  coach_group_players: [{ id: "link", group_id: "group", player_user_id: "junior", profiles: person("junior", "Léa") }],
  coach_group_coaches: [{ id: "head", group_id: "group", coach_user_id: "zcoach", is_head: true, profiles: person("zcoach", "Zoé") }],
  club_events: [{ id: "event", group_id: "group", status: "scheduled", starts_at: "2099-01-01T09:00:00Z", series_id: "series" }],
}; }
function setup(path: string, opts: { data?: Record<string, Row[]>; request?: (url: string, init?: RequestInit) => Promise<Response>; from?: any; clubs?: typeof club[] } = {}) {
  const lang = localized(), fixture = managerDatabase(opts.data ?? tables()), navigated: string[] = [], params = new URLSearchParams(); let reads = 0;
  const navigate = (url: string) => { navigated.push(url); const next = new URL(url, "http://local"); params.forEach((_, key) => params.delete(key)); next.searchParams.forEach((value, key) => params.set(key, value)); };
  const h = coachComponentHarness(path, { database: { from: opts.from ?? fixture.db.from, rpc: fixture.db.rpc }, modules: {
    "@/components/i18n/AppI18nProvider": lang.module,
    "next/navigation": { useParams: () => ({ id: "group" }), useSearchParams: () => params, useRouter: () => ({ push: navigate, replace: navigate }) },
  }, fetch: async (url, init) => { reads++; return opts.request ? opts.request(String(url), init) : Response.json({ clubs: opts.clubs ?? [club] }); } });
  return { h, lang, fixture, navigated, params, reads: () => reads };
}

test("group UI resolves four languages, complete count phrases and accessible labels", () => {
  for (const [key, values] of Object.entries(managerGroupEntries)) for (const l of locales) {
    assert.ok(msg(l, key).trim());
    const tokens = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
    assert.deepEqual(tokens(msg(l, key)), tokens(values[0]), `${l}:${key}`);
  }
  assert.equal(managerGroupFormat(t("en"), "deleteNamed", { name: "Name {name}" }), "Delete Name {name}");
  for (const path of paths) {
    const source = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, source, 99, true, ts.ScriptKind.TSX);
    function visit(n: ts.Node) { if (ts.isJsxText(n)) assert.doesNotMatch(n.text, /[A-Za-zÀ-ÿ]{2}/, `${path}:${n.text}`); if (ts.isJsxAttribute(n) && ["label", "title", "aria-label", "placeholder"].includes(n.name.getText(ast)) && n.initializer && ts.isStringLiteral(n.initializer)) assert.doesNotMatch(n.initializer.text, /[A-Za-zÀ-ÿ]{2}/, path); ts.forEachChild(n, visit); } visit(ast);
    for (const [, key] of source.matchAll(/\bt\("([^"]+)"\)/g)) for (const l of locales) assert.ok(messages[l][key], `${l}:${key}`);
  }
});

test("group filters, authored names and selected season survive a locale change", async () => {
  const x = setup(paths[0]); let tree = await settle(x.h); field(tree, msg("fr", "search")).props.onChange({ target: { value: "Groupe" } }); tree = x.h.render(); const before = x.reads();
  for (const l of locales) { x.lang.set(l); tree = await settle(x.h); assert.equal(x.reads(), before); assert.equal(field(tree, msg(l, "search")).props.value, "Groupe"); assert.ok(ui(tree).includes("Catégorie maison")); assert.ok(elements(tree).some(n => n.props.href === "/manager/groups/group?season=season")); assert.doesNotMatch(ui(tree), /manager\.groups\./); }
  x.h.cleanup();
});

for (const failureStep of ["head", "categories", "junior"]) test(`creation resumes a failed ${failureStep} step without repeating acknowledged writes`, async () => {
  const base = managerDatabase(tables()), writes: any[] = []; let fail = true;
  const x = setup(paths[1], { from: (table: string) => { const q = base.db.from(table), insert = q.insert; q.insert = (values: any) => { writes.push({ table, values }); const shouldFail = fail && ((failureStep === "head" && table === "coach_group_coaches" && values.is_head) || (failureStep === "categories" && table === "coach_group_categories")); return shouldFail ? { then: (yes: any) => Promise.resolve({ error: { message: "Diagnostic test" } }).then(yes) } as any : insert(values); }; return q; }, request: async (url, init) => { if (init?.method === "POST") { const body = JSON.parse(String(init.body)); writes.push({ table: "assignments", values: body }); return Response.json(fail && failureStep === "junior" && body.userId === "second" ? { error: "Diagnostic test" } : { ok: true }, { status: fail && failureStep === "junior" && body.userId === "second" ? 500 : 200 }); } return Response.json({ clubs: [club] }); } });
  let tree = await settle(x.h); field(tree, msg("fr", "namePlaceholder")).props.onChange({ target: { value: "Nom {name}" } }); tree = x.h.render();
  field(tree, msg("fr", "categoryPlaceholder")).props.onChange({ target: { value: "Ma catégorie" } }); tree = x.h.render(); button(tree, t("fr")("coach.group.addCategory")).props.onClick(); tree = x.h.render();
  for (const name of ["Zoé", "Alex", "Léa", "Tom"]) { button(tree, managerGroupFormat(t("fr"), "addNamed", { name: `${name} Exemple` })).props.onClick(); tree = x.h.render(); }
  const head = () => elements(tree).find(n => n.type === "select" && elements(n).some(o => o.type === "option" && o.props.value === "zcoach"))!;
  assert.equal(head().props.value, "zcoach", "first selected head coach must not be replaced by alphabetic order");
  const before = x.reads(); for (const l of locales) { x.lang.set(l); tree = await settle(x.h); assert.equal(x.reads(), before); assert.equal(field(tree, msg(l, "namePlaceholder")).props.value, "Nom {name}"); assert.equal(head().props.value, "zcoach"); assert.ok(ui(tree).includes("Ma catégorie")); assert.doesNotMatch(ui(tree), /manager\.groups\./); }
  const submit = () => elements(tree).find(n => n.type === "form")!.props.onSubmit(event);
  await Promise.all([submit(), submit()]); tree = await settle(x.h); assert.equal(x.navigated.length, 0); assert.ok(ui(tree).includes(msg("it", "partialCreation"))); assert.ok(elements(tree).some(n => n.type === "fieldset" && n.props.disabled));
  const initialWrites = writes.length; fail = false; await submit(); tree = await settle(x.h);
  assert.equal(writes.filter(w => w.table === "coach_groups").length, 1);
  assert.equal(writes.find(w => w.table === "coach_groups").values.head_coach_user_id, "zcoach");
  assert.equal(writes.find(w => w.table === "coach_groups").values.name, "Nom {name}");
  assert.equal(writes.find(w => w.table === "coach_groups").values.club_season_id, "season");
  assert.equal(writes.filter(w => w.table === "assignments" && w.values.userId === "junior").length, 1);
  assert.ok(writes.length > initialWrites); assert.equal(x.navigated.length, 1); assert.match(x.navigated[0], /\?season=season$/); x.h.cleanup();
});

test("editing group assignments keeps unsaved settings and releases buttons after a network failure", async () => {
  let fail = true; const writes: any[] = [];
  const x = setup(paths[2], { request: async (_url, init) => { writes.push(JSON.parse(String(init?.body))); if (fail) throw new Error("Network test"); return Response.json({ ok: true }); } });
  let tree = await settle(x.h); const name = elements(tree).find(n => n.type === "input" && n.props.value === "Groupe {name}")!; name.props.onChange({ target: { value: "Brouillon conservé" } }); tree = x.h.render();
  const add = managerGroupFormat(t("fr"), "addNamed", { name: "Tom Exemple" }); await button(tree, add).props.onClick(); tree = await settle(x.h); assert.ok(ui(tree).includes("Network test")); assert.equal(button(tree, add).props.disabled, false);
  fail = false; await button(tree, add).props.onClick(); tree = await settle(x.h); assert.ok(elements(tree).some(n => n.props.value === "Brouillon conservé")); assert.deepEqual(writes[1], { actorType: "player", userId: "second", toGroupId: "group", seasonId: "season" });
  const before = x.reads(); for (const l of locales) { x.lang.set(l); tree = await settle(x.h); assert.equal(x.reads(), before); assert.ok(elements(tree).some(n => n.props.value === "Brouillon conservé")); assert.ok(ui(tree).includes("Catégorie maison")); assert.doesNotMatch(ui(tree), /manager\.groups\./); }
  await elements(tree).find(n => n.type === "form")!.props.onSubmit(event); assert.equal(x.fixture.writes[0].values.name, "Brouillon conservé"); x.h.cleanup();
});

test("group list ignores an older season response after the selection changes", async () => {
  const data = tables(); data.club_seasons.push({ ...season, id: "old", name: "Ancienne saison", is_current: false }); data.coach_groups.push({ ...data.coach_groups[0], id: "old-group", club_season_id: "old", name: "Ancien groupe" });
  const base = managerDatabase(data), wait = deferred<any>(); let delayed = false;
  const x = setup(paths[0], { from: (table: string) => { const q = base.db.from(table), eq = q.eq, then = q.then; let old = false; q.eq = (key: string, val: unknown) => { if (table === "coach_groups" && key === "club_season_id" && val === "old") old = true; return eq(key, val); }; q.then = (yes, no) => delayed && old ? wait.promise.then(yes, no) : then(yes, no); return q; } });
  let tree = await settle(x.h); delayed = true; field(tree, t("fr")("manager.season")).props.onChange({ target: { value: "old" } }); await flush(); tree = x.h.render(); field(tree, t("fr")("manager.season")).props.onChange({ target: { value: "season" } }); tree = await settle(x.h); wait.resolve({ data: [data.coach_groups[1]], error: null }); tree = await settle(x.h); assert.ok(ui(tree).includes("Groupe {name}")); assert.ok(!ui(tree).includes("Ancien groupe")); x.h.cleanup();
});

test("changing group club updates the URL and hides the previous club while loading", async () => {
  const second = { id: "other", name: "Autre club" };
  const data = tables();
  data.club_seasons.push({ ...season, id: "other-season", club_id: second.id, name: "Autre saison" });
  data.coach_groups.push({ ...data.coach_groups[0], id: "other-group", club_id: second.id, club_season_id: "other-season", name: "Autre groupe" });
  const x = setup(paths[0], { data, clubs: [club, second] });
  let tree = await settle(x.h);
  assert.ok(ui(tree).includes("Groupe {name}"));
  field(tree, msg("fr", "club")).props.onChange({ target: { value: second.id } });
  tree = x.h.render();
  assert.equal(x.navigated.at(-1), "/manager/groups?club=other");
  assert.ok(!ui(tree).includes("Groupe {name}"));
  tree = await settle(x.h);
  assert.ok(ui(tree).includes("Autre groupe"));
  assert.ok(!ui(tree).includes("Groupe {name}"));
  x.h.cleanup();
});

test("an older group club lookup cannot restore the wrong club", async () => {
  const second = { id: "other", name: "Autre club" };
  const data = tables();
  data.club_seasons.push({ ...season, id: "other-season", club_id: second.id, name: "Autre saison" });
  data.coach_groups.push({ ...data.coach_groups[0], id: "other-group", club_id: second.id, club_season_id: "other-season", name: "Autre groupe" });
  const late = deferred<Response>();
  let lookup = 0;
  const x = setup(paths[0], { data, request: async () => {
    lookup += 1;
    return lookup === 2 ? late.promise : Response.json({ clubs: [club, second] });
  } });
  let tree = await settle(x.h);
  field(tree, msg("fr", "club")).props.onChange({ target: { value: second.id } });
  tree = x.h.render();
  await flush();
  field(tree, msg("fr", "club")).props.onChange({ target: { value: club.id } });
  tree = await settle(x.h);
  late.resolve(Response.json({ clubs: [club, second] }));
  tree = await settle(x.h);
  assert.equal(field(tree, msg("fr", "club")).props.value, club.id);
  assert.ok(ui(tree).includes("Groupe {name}"));
  assert.ok(!ui(tree).includes("Autre groupe"));
  x.h.cleanup();
});
