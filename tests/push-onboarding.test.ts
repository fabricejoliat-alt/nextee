/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled component effects and device fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";

function fixture(t: any, options: { decision?: string; supported?: boolean; permission?: string; activation?: { ok: boolean; reason?: string } } = {}) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: false }) } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  t.after(() => { for (const [name, previous] of [["window", oldWindow], ["document", oldDocument]] as const) {
    if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name);
  } });
  let decision = options.decision;
  const calls: any[] = [];
  const mount = () => coachComponentHarness("components/notifications/PushActivationBanner.tsx", {
    props: { settingsHref: "/player/notifications/settings" }, fetch: async () => { throw new Error("unexpected fetch"); },
    modules: {
      "next/navigation": { usePathname: () => "/player" },
      "@/lib/supabaseClient": { supabase: { auth: { getUser: async () => ({ data: { user: { id: "player" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } },
      "@/lib/notificationPreferences": { loadMyNotificationPreferences: async () => ({ receiveInApp: true, receivePush: false }),
        upsertMyNotificationPreferences: async (id: string, patch: any) => { calls.push({ id, patch }); } },
      "@/lib/pushClient": { supportsPush: () => options.supported !== false, isNativeApp: () => true,
        pushPermission: async () => options.permission ?? "prompt", hasLocalPushSubscription: async () => false,
        ensurePushSubscription: async (input: any) => { calls.push(input); return options.activation ?? { ok: true }; },
        pushFailureMessage: () => "notifications.settings.pushDenied" },
      "@/lib/pushOnboarding": { readPushDecision: () => decision, rememberPushDecision: (_: string, choice: string) => { decision = choice; } },
    },
  });
  return { mount, calls, decision: () => decision };
}
const click = (tree: any, label: string) => {
  const button = elements(tree).find(node => node.type === "button" && textContent(node) === label);
  assert(button, label); return button.props.onClick();
};

test("first sign-in proposes Yes/No even with push off, without requesting permission automatically", async t => {
  const f = fixture(t), h = f.mount();
  try { h.render(); await flush(); const tree = h.render();
    assert(textContent(tree).includes("Activer les notifications sur cet appareil ?"));
    assert.equal(f.calls.length, 0);
    click(tree, "Non");
    assert.equal(h.render(), null);
    assert.equal(f.decision(), "declined");
    assert.equal(f.calls.length, 0); // No account-wide preference is disabled.
    const again = f.mount(); try { again.render(); await flush(); assert.equal(again.render(), null); } finally { again.cleanup(); }
  } finally { h.cleanup(); }
});

test("Yes activates the device once and persists the enabled preference only after success", async t => {
  const f = fixture(t), h = f.mount();
  try { h.render(); await flush(); const tree = h.render();
    click(tree, "Oui"); click(tree, "Oui"); await flush();
    assert.deepEqual(f.calls, [{ prompt: true }, { id: "player", patch: { receivePush: true } }]);
    assert.equal(f.decision(), "accepted"); assert.equal(h.render(), null);
  } finally { h.cleanup(); }
});

test("a refused permission never saves a false activation or confirmed Yes", async t => {
  const f = fixture(t, { activation: { ok: false, reason: "denied" } }), h = f.mount();
  try { h.render(); await flush(); click(h.render(), "Oui"); await flush();
    assert.deepEqual(f.calls, [{ prompt: true }]); assert.equal(f.decision(), undefined);
    assert(textContent(h.render()).includes("Les notifications sont bloquées."));
  } finally { h.cleanup(); }
});

test("unsupported devices and existing OS refusals do not show a blocking iOS popup", async t => {
  const f = fixture(t, { supported: false }), h = f.mount();
  try { h.render(); await flush(); assert.equal(h.render(), null); assert.equal(f.calls.length, 0); } finally { h.cleanup(); }
});
