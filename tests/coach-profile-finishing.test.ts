import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";

const row = { first_name: "Coach", last_name: "Test", handedness: "right" };
const init = (options: { fetch?: typeof fetch; save?: () => Promise<unknown> } = {}) => coachComponentHarness("app/coach/profile/page.tsx", {
  fetch: options.fetch ?? (async () => Response.json({ memberships: [] })),
  modules: { "react-easy-crop": { __esModule: true, default: "cropper" } },
  database: { from: (table: string) => ({
    select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: row, error: null }),
      eq: async () => ({ data: [], error: null }),
    }) }),
    upsert: () => { assert.equal(table, "profiles"); return options.save?.() ?? Promise.resolve({ error: null }); },
  }) },
});
function saveButton(tree: Element) {
  const result = elements(tree).find((node) => node.type === "button" && textContent(node) === messages.fr["common.save"]);
  assert.ok(result); return result;
}
function field(tree: Element, label: string) {
  const result = elements(tree).find((node) => node.props.label === label);
  assert.ok(result); const input = elements(result).find((node) => node.type === "input");
  assert.ok(input); return input;
}

test("Coach profile uses card loading then four-language copy without losing an edited field", async () => {
  let reads = 0;
  const harness = init({ fetch: async () => { reads++; return Response.json({ memberships: [] }); } });
  try {
    assert.ok(elements(harness.render()).some((node) => node.type === "skeleton")); await flush();
    field(harness.render(), messages.fr["coach.profile.firstName"]).props.onChange({ target: { value: "Draft" } });
    for (const locale of ["fr", "en", "de", "it"] as const) {
      harness.setLocale(locale);
      const tree = harness.render();
      assert.ok(textContent(tree).includes(messages[locale]["coach.profile.title"]));
      assert.equal(field(tree, messages[locale]["coach.profile.firstName"]).props.value, "Draft");
    }
    assert.equal(reads, 1);
  } finally { harness.cleanup(); }
});

test("Coach profile failed loading exposes retry and no writable defaults", async () => {
  let reads = 0;
  const harness = init({ fetch: async () => { if (++reads === 1) throw new Error("private detail"); return Response.json({ memberships: [] }); } });
  try {
    harness.render(); await flush();
    let tree = harness.render();
    assert.ok(textContent(tree).includes(messages.fr["coach.profile.loadError"]));
    assert.ok(!textContent(tree).includes("private detail"));
    assert.ok(!elements(tree).some((node) => node.type === "fieldset"));
    const retry = elements(tree).find((node) => node.type === "button" && textContent(node) === messages.fr["coach.retry"]);
    assert.ok(retry); retry.props.onClick(); await flush();
    tree = harness.render(); assert.equal(saveButton(tree).props.disabled, false);
  } finally { harness.cleanup(); }
});

test("Coach profile save is locked against doubles and retains the draft after errors", async () => {
  const pending = deferred<unknown>(); let writes = 0;
  const harness = init({ save: async () => { writes++; return pending.promise; } });
  try {
    harness.render(); await flush();
    field(harness.render(), messages.fr["coach.profile.firstName"]).props.onChange({ target: { value: "Draft" } });
    const save = saveButton(harness.render()); save.props.onClick(); save.props.onClick(); await flush();
    assert.equal(writes, 1);
    assert.ok(elements(harness.render()).some((node) => node.type === "fieldset" && node.props.disabled));
    pending.resolve({ error: { message: "private detail" } }); await flush();
    const tree = harness.render();
    assert.equal(field(tree, messages.fr["coach.profile.firstName"]).props.value, "Draft");
    assert.equal(saveButton(tree).props.disabled, false);
    assert.ok(textContent(tree).includes(messages.fr["coach.profile.saveError"]));
  } finally { harness.cleanup(); }
});

test("Coach profile validates password confirmation before any profile mutation", async () => {
  let writes = 0;
  const harness = init({ save: async () => { writes++; return { error: null }; } });
  try {
    harness.render(); await flush();
    field(harness.render(), messages.fr["coach.profile.password"]).props.onChange({ target: { value: "fake-test-only" } });
    saveButton(harness.render()).props.onClick(); await flush();
    assert.equal(writes, 0);
    assert.ok(textContent(harness.render()).includes(messages.fr["coach.profile.passwordMismatch"]));
    assert.equal(saveButton(harness.render()).props.disabled, false);
  } finally { harness.cleanup(); }
});

test("Coach profile reports partial saves when organization fields fail", async () => {
  const harness = init({ fetch: async (_url, options) => options?.method === "PATCH"
    ? Response.json({ error: "private detail" }, { status: 500 })
    : Response.json({ memberships: [{ member_id: "member", club_id: "club", club_name: "Test", role: "coach", fields: [{ id: "field", field_type: "text", label: "Test", value: "Draft", editable_in_profile: true }] }] }) });
  try {
    harness.render(); await flush(); saveButton(harness.render()).props.onClick(); await flush();
    const text = textContent(harness.render());
    assert.ok(text.includes(messages.fr["coach.profile.partialError"]));
    assert.ok(!text.includes(messages.fr["coach.profile.saved"]));
    assert.equal(saveButton(harness.render()).props.disabled, false);
  } finally { harness.cleanup(); }
});
