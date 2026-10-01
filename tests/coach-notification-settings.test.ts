import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";
import { nextNotificationKinds, NO_NOTIFICATION_KINDS } from "../lib/notificationKindSelection.ts";

const allKinds = ["thread_message", "coach_event_created", "competition_reminder", "coach_event_updated", "coach_event_deleted", "coach_player_evaluated", "player_marked_absent", "player_marked_present"];
const defaults = { receiveInApp: true, receivePush: false, enabledKinds: [] as string[] };
const toggle = (tree: Element, label: string) => {
  const control = elements(tree).find((node) => node.props.label === label && typeof node.props.onToggle === "function");
  assert.ok(control, label); return control;
};
const init = (options: { load?: () => Promise<typeof defaults>; save?: (id: string, patch: Partial<typeof defaults>) => Promise<typeof defaults>; push?: () => Promise<unknown> } = {}) => coachComponentHarness("components/notifications/NotificationSettings.tsx", {
  props: { homeHref: "/coach", notificationsHref: "/coach/notifications", designVariant: "management" },
  fetch: async () => { throw new Error("Unexpected network request"); },
  modules: {
    "@/lib/notificationPreferences": {
      DEFAULT_NOTIFICATION_PREFERENCES: defaults,
      NOTIFICATION_KIND_OPTIONS: allKinds.map((kind) => ({ kind })),
      loadMyNotificationPreferences: options.load ?? (async () => defaults),
      upsertMyNotificationPreferences: options.save ?? (async (_id: string, patch: Partial<typeof defaults>) => ({ ...defaults, ...patch })),
    },
    "@/lib/pushClient": { supportsWebPush: () => true, ensurePushSubscription: options.push ?? (async () => ({ ok: true })), disablePushSubscription: async () => ({ ok: true }) },
  },
});

test("notification settings and all category labels translate in four languages without reloading preferences", async () => {
  let reads = 0;
  const harness = init({ load: async () => { reads++; return defaults; } });
  try {
    assert.ok(elements(harness.render()).some((node) => node.type === "skeleton"));
    await flush();
    for (const locale of ["fr", "en", "de", "it"] as const) {
      harness.setLocale(locale);
      const tree = harness.render();
      assert.ok(textContent(tree).includes(messages[locale]["notifications.settings.title"]));
      for (const kind of allKinds) assert.ok(toggle(tree, messages[locale][`notifications.kind.${kind}`]));
    }
    assert.equal(reads, 1);
  } finally { harness.cleanup(); }
});

test("failed notification loading never exposes writable default settings or raw backend errors", async () => {
  const harness = init({ load: async () => { throw new Error("private SQL detail"); } });
  try {
    harness.render(); await flush();
    const tree = harness.render();
    assert.ok(textContent(tree).includes(messages.fr["notifications.settings.loadError"]));
    assert.ok(!textContent(tree).includes("private SQL"));
    assert.ok(!elements(tree).some((node) => typeof node.props.onToggle === "function"));
    assert.ok(elements(tree).some((node) => node.type === "button" && textContent(node) === messages.fr["coach.retry"]));
  } finally { harness.cleanup(); }
});

test("notification save rejects double sends and keeps the confirmed switch state after failure", async () => {
  const pending = deferred<typeof defaults>(); let writes = 0;
  const harness = init({ save: async () => { writes++; return pending.promise; } });
  try {
    harness.render(); await flush();
    const control = toggle(harness.render(), messages.fr["notifications.settings.inApp"]);
    control.props.onToggle(false); control.props.onToggle(false); await flush();
    assert.equal(writes, 1);
    assert.equal(toggle(harness.render(), messages.fr["notifications.settings.inApp"]).props.checked, true);
    assert.equal(toggle(harness.render(), messages.fr["notifications.settings.inApp"]).props.disabled, true);
    // A failing thenable exercises the real catch without an unhandled rejection.
    pending.resolve(Promise.reject(new Error("private save detail")) as unknown as typeof defaults);
    await flush();
    const tree = harness.render();
    assert.equal(toggle(tree, messages.fr["notifications.settings.inApp"]).props.checked, true);
    assert.equal(toggle(tree, messages.fr["notifications.settings.inApp"]).props.disabled, false);
    assert.ok(textContent(tree).includes(messages.fr["notifications.settings.saveError"]));
    assert.ok(!textContent(tree).includes("private save detail"));
  } finally { harness.cleanup(); }
});

test("push permission failures are contained and release the save lock without changing preferences", async () => {
  let writes = 0;
  const harness = init({ push: async () => { throw new Error("browser detail"); }, save: async () => { writes++; return defaults; } });
  try {
    harness.render(); await flush();
    toggle(harness.render(), messages.fr["notifications.settings.push"]).props.onToggle(true);
    await flush();
    const tree = harness.render();
    assert.equal(writes, 0);
    assert.equal(toggle(tree, messages.fr["notifications.settings.push"]).props.checked, false);
    assert.equal(toggle(tree, messages.fr["notifications.settings.push"]).props.disabled, false);
    assert.ok(textContent(tree).includes(messages.fr["notifications.settings.pushError"]));
  } finally { harness.cleanup(); }
});

test("disabling the final category stays disabled, then re-enables only the requested category", () => {
  let selected: string[] = [];
  for (const kind of allKinds) selected = nextNotificationKinds(selected, kind, false, allKinds);
  assert.deepEqual(selected, [NO_NOTIFICATION_KINDS]);
  for (const kind of allKinds) assert.ok(!selected.includes(kind));
  assert.deepEqual(nextNotificationKinds(selected, "thread_message", true, allKinds), ["thread_message"]);
  assert.deepEqual(nextNotificationKinds(["thread_message", "future_kind"], "thread_message", false, allKinds), ["future_kind"]);
});

function preferencesLibrary(readError: string | null = null, writeError: string | null = null) {
  const compiled = ts.transpileModule(readFileSync(new URL("../lib/notificationPreferences.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const compiledModule = { exports: {} as typeof import("../lib/notificationPreferences") };
  const supabase = { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: readError ? { message: readError } : null }) }) }),
    upsert: async () => ({ error: writeError ? { message: writeError } : null }),
  }) };
  new Function("require", "module", "exports", compiled)(() => ({ supabase }), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

test("the actual delivery filters respect no categories and retain the legacy all-categories default", () => {
  const { isKindEnabled, isKindEnabledForPush } = preferencesLibrary();
  for (const kind of allKinds) {
    assert.equal(isKindEnabled(kind, defaults), true);
    assert.equal(isKindEnabled(kind, { ...defaults, enabledKinds: [NO_NOTIFICATION_KINDS] }), false);
    assert.equal(isKindEnabledForPush(kind, { ...defaults, receivePush: true, enabledKinds: [NO_NOTIFICATION_KINDS] }), false);
  }
});

test("missing preference storage is an error, never a false successful read or save", async () => {
  await assert.rejects(preferencesLibrary("relation does not exist").loadMyNotificationPreferences("coach"), /relation/);
  await assert.rejects(preferencesLibrary(null, "relation does not exist").upsertMyNotificationPreferences("coach", { receiveInApp: false }), /relation/);
});
