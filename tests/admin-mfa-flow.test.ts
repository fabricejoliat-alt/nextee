import test from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";

type Status = { mfa: boolean; recent: boolean };
type Verification = { data: { access_token: string }; error: null } | { data: null; error: { message: string } };

function fixture(initial: Status, verification?: Promise<Verification>) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  let statusRead = async (): Promise<Status> => initial;
  let reads = 0, submissions = 0, factorReads = 0;
  const tokens: string[] = [];
  let authChanged: (event: string) => void = () => {};
  const harness = coachComponentHarness("components/admin/AdminMfaGuard.tsx", {
    props: { children: "ADMIN CONTENT" },
    fetch: async (_input, init) => {
      reads++; tokens.push(new Headers(init?.headers).get("Authorization") ?? "");
      return Response.json(await statusRead());
    },
    modules: {
      "next/image": { __esModule: true, default: "img" },
      "@/lib/supabaseClient": { supabase: { auth: {
        getSession: async () => ({ data: { session: { access_token: "old-test-token" } } }),
        onAuthStateChange: (callback: typeof authChanged) => {
          authChanged = callback; return { data: { subscription: { unsubscribe() {} } } };
        },
        mfa: {
          listFactors: async () => {
            factorReads++; return { data: { totp: [{ id: "test-factor", status: "verified" }] }, error: null };
          },
          challengeAndVerify: async () => {
            submissions++;
            return verification ?? { data: { access_token: "verified-test-token" }, error: null };
          },
        },
      } } },
    },
  });
  const reauth = (code = "ADMIN_REAUTH_REQUIRED") => events.dispatchEvent(new CustomEvent("admin:reauth-required", { detail: { code } }));
  return {
    harness, reauth, signOut: () => authChanged("SIGNED_OUT"),
    setStatus(read: () => Promise<Status>) { statusRead = read; },
    counts: () => ({ reads, submissions, factorReads }), tokens,
    cleanup() {
      harness.cleanup();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

function form(tree: Element) {
  const result = elements(tree).find(node => node.type === "form");
  assert.ok(result); return result;
}

test("the same panel stays mounted until server confirmation, then opens Admin directly", async () => {
  const pending = deferred<Verification>();
  const confirmed = deferred<Status>();
  const f = fixture({ mfa: false, recent: false }, pending.promise);
  try {
    f.harness.render(); await flush();
    let tree = f.harness.render();
    elements(tree).find(node => node.type === "input")!.props.onChange({ target: { value: "123456" } });
    tree = f.harness.render();
    const submit = form(tree).props.onSubmit;
    const work = submit({ preventDefault() {} });
    await submit({ preventDefault() {} });
    tree = f.harness.render();
    assert.equal(f.counts().submissions, 1);
    assert.equal(form(tree).props["aria-busy"], true);
    assert.ok(textContent(tree).includes("Vérification en cours…"));
    f.reauth(); f.reauth("ADMIN_MFA_REQUIRED");
    assert.equal(elements(f.harness.render()).find(node => node.type === "input")!.props.value, "123456");
    f.setStatus(() => confirmed.promise);
    pending.resolve({ data: { access_token: "verified-test-token" }, error: null }); await flush();
    tree = f.harness.render();
    assert.equal(tree.type, "main");
    assert.equal(form(tree).props["aria-busy"], true);
    assert.ok(!textContent(tree).includes("ADMIN CONTENT"));
    assert.equal(f.tokens.at(-1), "Bearer verified-test-token");
    confirmed.resolve({ mfa: true, recent: true }); await work;
    tree = f.harness.render();
    assert.ok(textContent(tree).includes("ADMIN CONTENT"));
    assert.ok(!elements(tree).some(node => node.type === "form" || node.props.role === "dialog"));
    f.setStatus(async () => ({ mfa: true, recent: true }));
    f.reauth(); await flush();
    assert.ok(!elements(f.harness.render()).some(node => node.props.role === "dialog"));
  } finally { f.cleanup(); }
});

test("late authorization failures with a current valid session never open another dialog", async () => {
  const f = fixture({ mfa: true, recent: true });
  try {
    f.harness.render(); await flush(); f.harness.render();
    const before = f.counts().reads;
    f.reauth(); f.reauth(); f.reauth("ADMIN_MFA_REQUIRED"); await flush();
    assert.equal(f.counts().reads, before + 1);
    assert.ok(!elements(f.harness.render()).some(node => node.props.role === "dialog"));
  } finally { f.cleanup(); }
});

test("expired verification opens one dialog, preserves input and work, then closes once", async () => {
  const f = fixture({ mfa: true, recent: false });
  try {
    f.harness.render(); await flush(); f.harness.render();
    f.reauth(); await flush();
    let tree = f.harness.render();
    assert.equal(elements(tree).filter(node => node.props.role === "dialog").length, 1);
    assert.ok(elements(tree).some(node => node.props.inert === true && textContent(node).includes("ADMIN CONTENT")));
    elements(tree).find(node => node.type === "input")!.props.onChange({ target: { value: "654321" } });
    const before = f.counts(); f.reauth(); f.reauth(); await flush();
    tree = f.harness.render();
    assert.equal(elements(tree).find(node => node.type === "input")!.props.value, "654321");
    assert.deepEqual(f.counts(), before);
    f.setStatus(async () => ({ mfa: true, recent: true }));
    await form(tree).props.onSubmit({ preventDefault() {} });
    tree = f.harness.render();
    assert.ok(!elements(tree).some(node => node.props.role === "dialog"));
    assert.ok(textContent(tree).includes("ADMIN CONTENT"));
  } finally { f.cleanup(); }
});

test("late MFA rejection does not demand a fresh code when aal2 reads are still authorized", async () => {
  const f = fixture({ mfa: true, recent: false });
  try {
    f.harness.render(); await flush(); f.harness.render();
    f.reauth("ADMIN_MFA_REQUIRED"); await flush();
    assert.ok(!elements(f.harness.render()).some(node => node.props.role === "dialog"));
    f.reauth("ADMIN_REAUTH_REQUIRED"); await flush();
    assert.ok(elements(f.harness.render()).some(node => node.props.role === "dialog"));
  } finally { f.cleanup(); }
});

test("failed server confirmation never releases Admin, and sign-out cancels pending verification", async () => {
  const f = fixture({ mfa: false, recent: false });
  try {
    f.harness.render(); await flush();
    await form(f.harness.render()).props.onSubmit({ preventDefault() {} });
    let tree = f.harness.render();
    assert.ok(textContent(tree).includes("Vérification indisponible"));
    assert.ok(!textContent(tree).includes("ADMIN CONTENT"));
    const waiting = deferred<Status>();
    f.setStatus(() => waiting.promise);
    const work = form(tree).props.onSubmit({ preventDefault() {} }); await flush();
    f.signOut(); waiting.resolve({ mfa: true, recent: true }); await work;
    tree = f.harness.render();
    assert.ok(!textContent(tree).includes("ADMIN CONTENT"));
  } finally { f.cleanup(); }
});
