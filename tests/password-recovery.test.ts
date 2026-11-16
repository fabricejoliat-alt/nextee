import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { capturePasswordRecoveryUrl, createPasswordRecoveryClient, preparePasswordRecoveryOnce, releasePasswordRecoveryPreparation } from "../lib/passwordRecovery.ts";
import { coachComponentHarness, elements, flush, textContent } from "./helpers/coachComponentHarness.ts";

const endpoint = "https://recovery-test.supabase.co";
const user = { id: "recovery-user", email: "recovery@example.test", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01" };
const accessToken = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.${Buffer.from("test-signature").toString("base64url")}`;
const session = { access_token: accessToken, refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user };

test("implicit and PKCE credentials are removed before the shared client initializes", () => {
  for (const suffix of ["?code=private-code", "#access_token=private-access&refresh_token=private-refresh&type=recovery"]) {
    const location = new URL(`https://activitee.app/reset-password${suffix}`);
    let rewritten = "";
    const browser = { location, history: { state: { preserved: true }, replaceState(state, _unused, url) {
      assert.deepEqual(state, { preserved: true });
      rewritten = String(url);
    } } } as unknown as Window;
    assert.equal(capturePasswordRecoveryUrl(browser), location.href);
    assert.equal(rewritten, "https://activitee.app/reset-password");
  }
  assert.equal(capturePasswordRecoveryUrl(undefined), null);
  assert.equal(capturePasswordRecoveryUrl({ location: new URL("https://activitee.app/player") } as unknown as Window), null);
});

test("recovery verification and failed password changes never authenticate the application", async () => {
  const applicationStorage = new Map<string, string>();
  let rejectPassword = true;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/verify")) return Response.json(session);
    if (init?.method === "PUT" && url.endsWith("/user")) {
      if (rejectPassword) return Response.json({ msg: "Password rejected", code: "weak_password" }, { status: 422 });
      return Response.json(user);
    }
    if (url.endsWith("/user")) return Response.json(user);
    throw new Error(`Unexpected Auth request: ${url}`);
  };
  const application = createClient(endpoint, "anon-key", {
    global: { fetch: fetcher },
    auth: { storageKey: "application-test", autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: key => applicationStorage.get(key) ?? null,
        setItem: (key, value) => { applicationStorage.set(key, value); },
        removeItem: key => { applicationStorage.delete(key); } } },
  });
  const recovery = await createPasswordRecoveryClient(endpoint, "anon-key", "", fetcher);
  assert.equal((await recovery.auth.verifyOtp({ token_hash: "recovery-hash", type: "recovery" })).error, null);
  assert.ok((await recovery.auth.getSession()).data.session);
  assert.equal((await application.auth.getSession()).data.session, null);
  assert.equal(applicationStorage.size, 0);
  assert.ok((await recovery.auth.updateUser({ password: "Abcde!" })).error);
  assert.equal((await application.auth.getSession()).data.session, null);
  assert.equal(applicationStorage.size, 0);

  // A new page has no recovery session, including after abandoning navigation.
  const nextPage = await createPasswordRecoveryClient(endpoint, "anon-key", "", fetcher);
  assert.equal((await nextPage.auth.getSession()).data.session, null);
  rejectPassword = false;
  assert.equal((await recovery.auth.updateUser({ password: "Abcde!" })).error, null);
  assert.equal((await application.auth.getSession()).data.session, null);
  assert.equal((await application.auth.setSession(session)).error, null);
  assert.equal((await application.auth.getSession()).data.session?.user.id, user.id);
  assert.ok(applicationStorage.size > 0);
});

test("PKCE verifier is copied without importing the previous account's session", async () => {
  const cookieHeader = `sb-recovery-test-auth-token-code-verifier=${encodeURIComponent(JSON.stringify("private-verifier/PASSWORD_RECOVERY"))}; sb-recovery-test-auth-token=previous-account-session`;
  const fetcher: typeof fetch = async (input, init) => {
    assert.ok(String(input).includes("grant_type=pkce"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.code_verifier, "private-verifier");
    return Response.json(session);
  };
  const recovery = await createPasswordRecoveryClient(endpoint, "anon-key", cookieHeader, fetcher);
  assert.equal((await recovery.auth.getSession()).data.session, null);
  assert.equal((await recovery.auth.exchangeCodeForSession("private-code")).error, null);
});

test("reset page publishes only after password success and has no sign-in event bypass", () => {
  const page = readFileSync(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("await passwordClient.auth.updateUser") < page.indexOf("await supabase.auth.setSession"));
  assert.match(page, /if \(updateError\)\s*\{[^}]*return;/);
  assert.doesNotMatch(page, /onAuthStateChange/);
  assert.match(page, /preparePasswordRecoveryOnce\(/);
  const shared = readFileSync(new URL("../lib/supabaseClient.ts", import.meta.url), "utf8");
  assert.ok(shared.indexOf("= capturePasswordRecoveryUrl") < shared.indexOf("= createBrowserClient"));
});

test("a remount keeps the preparation but leaving the reset route discards it", async () => {
  const link = `https://activitee.app/reset-password?token_hash=lifetime-${crypto.randomUUID()}`;
  let count = 0;
  const prepare = async () => { count++; return { valid: true, client: null }; };
  const first = preparePasswordRecoveryOnce(link, prepare);
  await first;
  releasePasswordRecoveryPreparation(link, "/reset-password");
  assert.equal(preparePasswordRecoveryOnce(link, prepare), first);
  assert.equal(count, 1);
  releasePasswordRecoveryPreparation(link, "/player");
  assert.notEqual(preparePasswordRecoveryOnce(link, prepare), first);
  await preparePasswordRecoveryOnce(link, prepare);
  assert.equal(count, 2);
  releasePasswordRecoveryPreparation(link, "/login");
});

test("sign-out remounts the reset form without consuming the link twice or losing its private session", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { cookie: "" } as Document;
  globalThis.window = { location: { pathname: "/reset-password" } } as Window & typeof globalThis;
  let authenticated = true;
  let rejectPassword = true;
  let destination = "";
  const calls: string[] = [];
  let h: ReturnType<typeof coachComponentHarness>;
  const application = { auth: {
    signOut: async () => {
      authenticated = false; calls.push("signOut");
      assert.equal(calls.filter(call => call === "signOut").length, 1);
      // AuthSessionBoundary clears retained pages on SIGNED_OUT. Recreate all
      // component hook state just as SessionPageBoundary does in production.
      h.cleanup(); h = makeHarness(); h.render();
      return { error: null };
    },
    setSession: async () => { authenticated = true; calls.push("publish"); return { error: null }; },
    getSession: async () => ({ data: { session: authenticated ? session : null } }),
  } };
  const recovery = { auth: {
    verifyOtp: async () => { calls.push("verify"); return { data: { session }, error: null }; },
    getSession: async () => ({ data: { session } }),
    updateUser: async () => { calls.push("password"); return { error: rejectPassword ? { message: "Password rejected" } : null }; },
  } };
  const search = `token_hash=ui-${crypto.randomUUID()}&type=recovery`;
  function makeHarness() { return coachComponentHarness("app/reset-password/page.tsx", {
    searchParams: search,
    fetch: async () => Response.json({ redirectTo: "/player" }),
    modules: {
      "next/navigation": { useSearchParams: () => new URLSearchParams(search), useRouter: () => ({ replace: path => { destination = path; } }) },
      "@/lib/supabaseClient": { supabase: application, passwordRecoveryUrl: `https://activitee.app/reset-password?${search}` },
      "@/lib/passwordRecovery": { createPasswordRecoveryClient: async () => recovery, preparePasswordRecoveryOnce, releasePasswordRecoveryPreparation },
    },
  }); }
  h = makeHarness();
  try {
    h.render(); await flush();
    let tree = h.render();
    assert.deepEqual(calls, ["signOut", "verify"]);
    assert.equal(authenticated, false);
    assert.ok(textContent(tree).includes("Nouveau mot de passe"));
    for (const input of elements(tree).filter(node => node.type === "input")) input.props.onChange({ target: { value: "Abcde!" } });
    tree = h.render();
    await elements(tree).find(node => node.type === "form")!.props.onSubmit({ preventDefault() {} });
    assert.equal(authenticated, false);
    assert.equal(destination, "");
    assert.ok(textContent(h.render()).includes("Password rejected"));
    rejectPassword = false;
    await elements(h.render()).find(node => node.type === "form")!.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(calls, ["signOut", "verify", "password", "password", "publish"]);
    assert.equal(authenticated, true);
    assert.equal(destination, "/player");
  } finally {
    h.cleanup();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
