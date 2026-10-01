import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";
import { coachDateLocale } from "../lib/i18n/coachMessages.ts";

const page = "app/coach/groups/[id]/page.tsx";
const originalGroup = { id: "group", club_id: "club", name: "Groupe témoin", is_active: true, head_coach_user_id: "head" };
const profile = { id: "junior", first_name: "Émile", last_name: "Témoin", handicap: 12.5, avatar_url: null };
type Query = { table: string; columns: string; action: string; filters: Record<string, unknown> };
type Result = { data: unknown; error: unknown };

function database(options: {
  role?: string; manage?: boolean; linked?: boolean; active?: boolean; transfer?: boolean;
  intercept?: (query: Query) => Result | Promise<Result> | undefined;
} = {}) {
  const reads: Query[] = [];
  const writes: Query[] = [];
  const from = (table: string) => {
    const state: Query = { table, columns: "", action: "read", filters: {} };
    const query = {
      select(columns: string) { state.columns = columns; return query; },
      eq(key: string, value: unknown) { state.filters[key] = value; return query; },
      in(key: string, value: unknown) { state.filters[key] = value; return query; },
      order() { return query; },
      maybeSingle() { return query; },
      insert(value: unknown) { state.action = "insert"; state.filters.body = value; return query; },
      delete() { state.action = "delete"; return query; },
      then(resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) {
        (state.action === "read" ? reads : writes).push(state);
        return Promise.resolve().then(async () => {
          const intercepted = await options.intercept?.(state);
          if (intercepted) return intercepted;
          if (state.action !== "read") return { data: null, error: null };
          let data: unknown = [];
          if (table === "coach_groups") data = { ...originalGroup, id: state.filters.id };
          if (table === "club_members") data = state.columns.startsWith("role,") ?
            options.active === false ? null : { role: options.role ?? "coach", can_manage_assigned_groups: options.manage ?? true,
              can_manage_assigned_group_planning: false, can_transfer_players_between_club_groups: options.transfer ?? false } :
            [{ user_id: "candidate", role: "coach", is_active: true }];
          if (table === "coach_group_coaches") data = state.columns === "id" ? options.linked === false ? null : { id: "link" } :
            [{ id: "head-link", coach_user_id: "head", is_head: true, profiles: { ...profile, first_name: "Head", id: "head" } },
              { id: "assistant-link", coach_user_id: "assistant", is_head: false, profiles: { ...profile, first_name: "Assistant", id: "assistant" } }];
          if (table === "coach_group_categories") data = [{ id: "category", group_id: "group", category: "Élite" }];
          if (table === "coach_group_players") data = [{ id: "player-link", group_id: "group", player_user_id: "junior", profiles: profile }];
          if (table === "club_events") data = [{ id: "event", starts_at: "2099-10-07T13:00:00Z", status: "scheduled", series_id: "series" }];
          if (table === "profiles") data = [{ ...profile, id: "candidate", first_name: "Candidate" }];
          return { data, error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  };
  return { from, reads, writes };
}
const find = (tree: Element, predicate: (element: Element) => boolean) => {
  const node = elements(tree).find(predicate);
  assert.ok(node, "Expected UI element");
  return node;
};
const nameInput = (tree: Element) => find(tree, (node) => node.type === "input" && node.props.minLength === 2);
const categoryInput = (tree: Element) => find(tree, (node) => node.type === "input" && node.props.placeholder);
const form = (tree: Element) => find(tree, (node) => node.type === "form");
const button = (tree: Element, label: string) => find(tree, (node) => node.type === "button" && (textContent(node) === label || node.props["aria-label"] === label));
const noFetch = async () => { throw new Error("Unexpected network request"); };

test("group details switch all four languages, dates and handicap without reloading or losing drafts", async () => {
  const db = database();
  const harness = coachComponentHarness(page, { params: { id: "group" }, database: db, fetch: noFetch });
  assert.ok(elements(harness.render()).some((node) => node.type === "skeleton"));
  await flush();
  let tree = harness.render();
  nameInput(tree).props.onChange({ target: { value: "Nom non enregistré" } });
  categoryInput(tree).props.onChange({ target: { value: "U16" } });
  const reads = db.reads.length;
  for (const locale of ["fr", "en", "de", "it"] as const) {
    harness.setLocale(locale); tree = harness.render();
    assert.ok(textContent(tree).includes(messages[locale]["coach.group.info"]));
    assert.ok(textContent(tree).includes(new Intl.NumberFormat(`${locale}-CH`, { minimumFractionDigits: 1 }).format(12.5)));
    assert.ok(textContent(tree).includes(new Intl.DateTimeFormat(coachDateLocale(locale), {
      weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date("2099-10-07T13:00:00Z"))));
    assert.ok(textContent(tree).includes("Émile Témoin"));
    assert.ok(textContent(tree).includes("Élite"));
    assert.equal(nameInput(tree).props.value, "Nom non enregistré");
    assert.equal(categoryInput(tree).props.value, "U16");
  }
  assert.equal(db.reads.length, reads);
  harness.cleanup();
});

test("group mutations block duplicates, recover from thrown network errors and retain the name for retry", async () => {
  let writes = 0;
  const pending = deferred<Response>();
  const harness = coachComponentHarness(page, { params: { id: "group" }, database: database(), fetch: async (_url, init) => {
    writes++; assert.equal(init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(init.body)), { name: "Nouveau nom" });
    if (writes === 1) return pending.promise;
    throw new Error("private network failure");
  } });
  harness.render(); await flush();
  nameInput(harness.render()).props.onChange({ target: { value: "Nouveau nom" } });
  let tree = harness.render();
  const submit = form(tree).props.onSubmit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  await flush();
  tree = harness.render();
  assert.equal(writes, 1);
  assert.equal(nameInput(tree).props.disabled, true);
  pending.resolve(Response.json({ error: "private database failure" }, { status: 500 }));
  await first;
  tree = harness.render();
  assert.equal(nameInput(tree).props.disabled, false);
  assert.equal(nameInput(tree).props.value, "Nouveau nom");
  assert.ok(textContent(tree).includes(messages.fr["coach.error.save"]));
  await form(tree).props.onSubmit({ preventDefault() {} });
  tree = harness.render();
  assert.equal(writes, 2);
  assert.equal(nameInput(tree).props.disabled, false);
  assert.ok(!textContent(tree).includes("private"));
  harness.cleanup();
});

test("category success preserves an unrelated group-name draft and cannot run a second mutation concurrently", async () => {
  let writes = 0;
  const pending = deferred<Response>();
  const harness = coachComponentHarness(page, { params: { id: "group" }, database: database(), fetch: async (_url, init) => {
    writes++; assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { category: "U16" });
    return pending.promise;
  } });
  harness.render(); await flush();
  let tree = harness.render();
  nameInput(tree).props.onChange({ target: { value: "Brouillon conservé" } });
  categoryInput(tree).props.onChange({ target: { value: "U16" } });
  tree = harness.render();
  button(tree, messages.fr["coach.group.addCategory"]).props.onClick();
  button(tree, "Supprimer Élite").props.onClick();
  await flush(); assert.equal(writes, 1);
  pending.resolve(Response.json({ ok: true })); await flush();
  tree = harness.render();
  assert.equal(nameInput(tree).props.value, "Brouillon conservé");
  assert.equal(categoryInput(tree).props.value, "");
  assert.ok(textContent(tree).includes(messages.fr["coach.group.saved"]));
  categoryInput(tree).props.onChange({ target: { value: "éLITE" } });
  tree = harness.render();
  assert.equal(button(tree, messages.fr["coach.group.addCategory"]).props.disabled, true);
  assert.ok(textContent(tree).includes(messages.fr["coach.group.duplicateCategory"]));
  harness.cleanup();
});

test("successful group rename refreshes the saved title and does not clear the category draft", async () => {
  let savedName = originalGroup.name;
  const db = database({ intercept: (query) => query.table === "coach_groups" ? { data: { ...originalGroup, name: savedName }, error: null } : undefined });
  const harness = coachComponentHarness(page, { params: { id: "group" }, database: db, fetch: async (_url, init) => {
    savedName = JSON.parse(String(init?.body)).name;
    return Response.json({ ok: true });
  } });
  harness.render(); await flush();
  nameInput(harness.render()).props.onChange({ target: { value: "  Nouveau groupe  " } });
  categoryInput(harness.render()).props.onChange({ target: { value: "Catégorie non enregistrée" } });
  await form(harness.render()).props.onSubmit({ preventDefault() {} });
  const tree = harness.render();
  assert.equal(nameInput(tree).props.value, "Nouveau groupe");
  assert.equal(categoryInput(tree).props.value, "Catégorie non enregistrée");
  assert.equal(textContent(find(tree, (node) => node.type === "h1")), "Nouveau groupe");
  assert.ok(textContent(tree).includes(messages.fr["coach.group.saved"]));
  harness.cleanup();
});

test("every failed group section hides incomplete data and offers a localized retry", async () => {
  for (const table of ["coach_groups", "club_members", "coach_group_categories", "coach_group_players", "coach_group_coaches", "club_events"]) {
    let fail = true;
    const db = database({ intercept: (query) => fail && query.table === table ? { data: null, error: { message: "secret SQL detail" } } : undefined });
    const harness = coachComponentHarness(page, { params: { id: "group" }, database: db, fetch: noFetch });
    harness.render(); await flush();
    let tree = harness.render();
    assert.ok(textContent(tree).includes(messages.fr["coach.error.load"]), table);
    assert.ok(!elements(tree).some((node) => node.type === "form"), table);
    assert.ok(!textContent(tree).includes("secret SQL"));
    harness.setLocale("it"); tree = harness.render();
    assert.ok(textContent(tree).includes(messages.it["coach.error.load"]));
    fail = false;
    button(tree, messages.it["coach.retry"]).props.onClick(); await flush();
    assert.equal(nameInput(harness.render()).props.value, originalGroup.name);
    harness.cleanup();
  }
});

test("a committed mutation followed by a failed refresh is not presented as a failed write", async () => {
  let failRefresh = false; let writes = 0;
  const db = database({ intercept: (query) => failRefresh && query.table === "club_events" ? { data: null, error: true } : undefined });
  const harness = coachComponentHarness(page, { params: { id: "group" }, database: db, fetch: async () => {
    writes++; failRefresh = true; return Response.json({ ok: true });
  } });
  harness.render(); await flush();
  nameInput(harness.render()).props.onChange({ target: { value: "Brouillon intact" } });
  categoryInput(harness.render()).props.onChange({ target: { value: "U16" } });
  button(harness.render(), messages.fr["coach.group.addCategory"]).props.onClick(); await flush();
  let tree = harness.render();
  assert.ok(textContent(tree).includes(messages.fr["coach.error.groupRefresh"]));
  assert.ok(!elements(tree).some((node) => node.type === "form"));
  failRefresh = false;
  button(tree, messages.fr["coach.retry"]).props.onClick(); await flush();
  tree = harness.render();
  assert.equal(nameInput(tree).props.value, "Brouillon intact");
  assert.equal(categoryInput(tree).props.value, "");
  assert.equal(writes, 1);
  harness.cleanup();
});

test("group editing remains permission-gated and revoked or unrelated memberships show no data", async () => {
  for (const options of [{ manage: false }, { active: false }, { linked: false }, { linked: false, transfer: true, manage: false }]) {
    const harness = coachComponentHarness(page, { params: { id: "group" }, database: database(options), fetch: noFetch });
    harness.render(); await flush();
    const tree = harness.render();
    assert.ok(!elements(tree).some((node) => node.type === "button" && node.props.type === "submit"));
    if (options.active === false || (options.linked === false && !options.transfer)) {
      assert.ok(!textContent(tree).includes("Émile Témoin"));
      assert.ok(textContent(tree).includes(messages.fr["coach.error.groupAccess"]));
    } else assert.equal(nameInput(tree).props.disabled, true);
    harness.cleanup();
  }
});

test("late group loads cannot replace a new route", async () => {
  const stale = deferred<Result>();
  const params = { id: "old" };
  const db = database({ intercept: (query) => query.table === "coach_groups" && query.filters.id === "old" ? stale.promise : undefined });
  const harness = coachComponentHarness(page, { params, database: db, fetch: noFetch });
  harness.render(); await flush();
  params.id = "new"; harness.render(); await flush();
  assert.ok(elements(harness.render()).some((node) => node.type === "a" && String(node.props.href).includes("/new/planning")));
  stale.resolve({ data: { ...originalGroup, id: "old", name: "Stale group" }, error: null }); await flush();
  assert.ok(!textContent(harness.render()).includes("Stale group"));
  harness.cleanup();
});

test("a late mutation response cannot clear the new route's drafts or show a false success", async () => {
  const pending = deferred<Response>();
  const params = { id: "old" };
  const harness = coachComponentHarness(page, { params, database: database(), fetch: async () => pending.promise });
  harness.render(); await flush();
  nameInput(harness.render()).props.onChange({ target: { value: "Ancien brouillon" } });
  const save = form(harness.render()).props.onSubmit({ preventDefault() {} });
  await flush();
  params.id = "new"; harness.render(); await flush();
  nameInput(harness.render()).props.onChange({ target: { value: "Nouveau brouillon" } });
  pending.resolve(Response.json({ ok: true })); await save;
  const tree = harness.render();
  assert.equal(nameInput(tree).props.value, "Nouveau brouillon");
  assert.ok(!textContent(tree).includes(messages.fr["coach.group.saved"]));
  assert.equal(nameInput(tree).props.disabled, false);
  harness.cleanup();
});

test("manager coach edits preserve the fixed head coach and localize database failures", async () => {
  const db = database({ role: "manager", intercept: (query) => query.action !== "read" ? { data: null, error: { message: "private SQL" } } : undefined });
  const harness = coachComponentHarness(page, { params: { id: "group" }, database: db, fetch: noFetch });
  harness.render(); await flush();
  let tree = harness.render();
  assert.ok(!elements(tree).some((node) => node.props["aria-label"] === "Retirer Head Témoin"));
  const picker = find(tree, (node) => node.type === "member-picker");
  assert.equal(await picker.props.onSelect({ id: "candidate" }), false);
  tree = harness.render();
  assert.equal(db.writes.length, 1);
  assert.ok(textContent(tree).includes(messages.fr["coach.error.save"]));
  assert.ok(!textContent(tree).includes("private SQL"));
  assert.equal(find(tree, (node) => node.type === "member-picker").props.disabled, false);
  harness.cleanup();
});

test("member search retains failed searches, filters accents, caps results and exposes keyboard controls", async () => {
  const pending = deferred<boolean>(); let calls = 0;
  const harness = coachComponentHarness("components/coach/CoachMemberPicker.tsx", { fetch: noFetch, props: {
    label: "Coach", placeholder: "Nom", items: [profile, ...Array.from({ length: 24 }, (_, i) => ({ ...profile, id: String(i), first_name: "Coach" }))],
    onSelect: async () => { calls++; return pending.promise; },
  } });
  let tree = harness.render();
  let input = find(tree, (node) => node.type === "input");
  input.props.onFocus(); tree = harness.render();
  assert.equal(elements(tree).filter((node) => node.type === "button").length, 20);
  input.props.onChange({ target: { value: "emile" } }); tree = harness.render();
  assert.ok(textContent(tree).includes("Émile Témoin"));
  const add = button(tree, "Ajouter Émile Témoin");
  add.props.onClick(); add.props.onClick(); await flush();
  assert.equal(calls, 1);
  pending.resolve(false); await flush();
  tree = harness.render(); input = find(tree, (node) => node.type === "input");
  assert.equal(input.props.value, "emile");
  assert.equal(input.props.disabled, false);
  assert.equal(find(tree, (node) => node.type === "label").props.htmlFor, input.props.id);
  for (const locale of ["fr", "en", "de", "it"] as const) {
    harness.setLocale(locale); tree = harness.render();
    assert.ok(textContent(tree).includes(messages[locale]["coach.picker.resultOne"].replace("{count}", "1")));
    assert.equal(find(tree, (node) => node.type === "input").props.value, "emile");
  }
  input.props.ref.current = { focus() { input.props.onFocus(); } };
  let prevented = false;
  tree.props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.ok(!elements(harness.render()).some((node) => node.props.id === input.props["aria-controls"]));
  harness.cleanup();
});
