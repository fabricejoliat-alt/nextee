import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server.js";
import { adminAssurance, isLegacyManagerAdminRoute } from "../lib/adminSecurity.ts";
import { randomPassword } from "../lib/server/initialPassword.ts";
import { adminContentSecurityPolicy } from "../lib/securityHeaders.ts";
import { loadManagerModule, managerDatabase, managerRequest } from "./helpers/managerRouteHarness.ts";

const now = Date.now();
const actor = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
const claims = (secondsAgo = 0) => ({ sub: actor, aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(now / 1000) - secondsAgo }] });

test("admin assurance requires the same actor, aal2, and a recent MFA timestamp", () => {
  assert.deepEqual(adminAssurance(claims(), actor, now), { mfa: true, recent: true });
  assert.deepEqual(adminAssurance(claims(901), actor, now), { mfa: true, recent: false });
  assert.equal(adminAssurance({ ...claims(), sub: target }, actor, now).mfa, false);
  assert.equal(adminAssurance({ ...claims(), aal: "aal1" }, actor, now).mfa, false);
  assert.equal(adminAssurance({ ...claims(), amr: ["totp"] }, actor, now).recent, false);
  assert.equal(adminAssurance(claims(-60), actor, now).recent, false);
});

function fixture(verifiedClaims: Record<string, unknown> = claims(), role = "admin", metadata = {}) {
  const h = managerDatabase({ app_admins: role === "admin" ? [{ user_id: actor }] : [] }, { caller: actor });
  h.db.auth.getUser = async () => ({ error: null, data: { user: { id: actor, app_metadata: metadata } } });
  Object.assign(h.db.auth, { getClaims: async () => ({ data: { claims: verifiedClaims }, error: null }) });
  return h;
}

async function proxyResult(path: string, h = fixture(), method = "GET") {
  const cookieClient = { auth: h.db.auth };
  const proxyModule = loadManagerModule<{ proxy: (r: NextRequest) => Promise<Response> }>("proxy.ts", {
    ...h.mocks, "next/server": { NextResponse }, "@supabase/ssr": { createServerClient: () => cookieClient },
  });
  return proxyModule.proxy(new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: "Bearer fixture" } }));
}

test("Admin API middleware denies aal1, stale writes and non-admin requests", async () => {
  const aal1 = fixture({ ...claims(), aal: "aal1" });
  const denied = await proxyResult("/api/admin/users/list", aal1);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "ADMIN_MFA_REQUIRED");
  assert.equal((await proxyResult("/api/admin/security", aal1)).status, 200);
  assert.equal((await proxyResult("/api/admin/security", aal1, "POST")).status, 403);
  assert.equal((await proxyResult("/api/admin/legal", fixture(claims(901)), "POST")).status, 403);
  assert.equal((await proxyResult("/api/admin/legal", fixture(claims(901)))).status, 200);
  assert.equal((await proxyResult("/api/admin/users/list", fixture(claims(), "player"))).status, 403);
  assert.equal((await proxyResult("/api/admin/organizations", fixture(claims(), "player"), "POST")).status, 403);
  assert.equal((await proxyResult("/api/admin/users/list", fixture())).status, 200);
});

test("legacy manager exceptions are limited to existing scoped endpoints", async () => {
  assert.equal(isLegacyManagerAdminRoute("/api/admin/clubs/A/create-member"), true);
  assert.equal(isLegacyManagerAdminRoute("/api/admin/clubs/A/add-existing-member-preview"), true);
  assert.equal(isLegacyManagerAdminRoute("/api/admin/organizations/A/group-assignments"), true);
  assert.equal(isLegacyManagerAdminRoute("/api/admin/clubs/A/settings"), false);
  assert.equal((await proxyResult("/api/admin/clubs/A/create-member", fixture(claims(), "manager"), "POST")).status, 200);
});

test("initial-password flag blocks business data and mutations before first password replacement", async () => {
  const h = fixture(claims(), "admin", { initial_password_required: true });
  const response = await proxyResult("/api/admin/users/update", h, "POST");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "INITIAL_PASSWORD_REQUIRED");
  const page = await proxyResult("/admin", h);
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location")!, /change-initial-password/);
  assert.equal(h.writes.length, 0);
});

test("Admin pages carry a nonce CSP and Admin replies cannot be cached", async () => {
  const response = await proxyResult("/admin");
  const csp = response.headers.get("Content-Security-Policy")!;
  assert.match(csp, /script-src 'self' 'nonce-/);
  assert.doesNotMatch(csp.split("script-src")[1].split(";")[0], /unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  const configured = adminContentSecurityPolicy("fixture", "https://fixture.supabase.co");
  assert.match(configured, /https:\/\/fixture.supabase.co wss:\/\/fixture.supabase.co/);
});

function audit(h = fixture()) {
  const mod = loadManagerModule<{ withAdminMutationAudit: (handler: (r: Request) => Promise<Response>) => (r: Request) => Promise<Response> }>("lib/server/adminAudit.ts", h.mocks);
  let writes = 0;
  const handler = mod.withAdminMutationAudit(async () => { writes++; return Response.json({ ok: true }); });
  return { h, handler, writes: () => writes };
}

test("audit records actor, target and outcome without any credential or body contents", async () => {
  const a = audit();
  const response = await a.handler(managerRequest("POST", { userId: target, auth_password: "never-log-this", first_name: "Private" }));
  assert.equal(response.status, 200); assert.equal(a.writes(), 1);
  assert.deepEqual(a.h.rpcs.map(r => r.args.p_phase), ["started", "succeeded"]);
  assert.equal(a.h.rpcs[0].args.p_actor, actor); assert.equal(a.h.rpcs[0].args.p_target, target);
  assert.equal(a.h.rpcs[0].args.p_request, a.h.rpcs[1].args.p_request);
  assert.doesNotMatch(JSON.stringify(a.h.rpcs), /never-log-this|Private/);
});

test("audit failure and stale/aal1 sessions prevent mutation", async () => {
  for (const c of [{ ...claims(), aal: "aal1" }, claims(901)]) {
    const a = audit(fixture(c)); assert.equal((await a.handler(managerRequest("POST"))).status, 403);
    assert.equal(a.writes(), 0); assert.equal(a.h.rpcs.length, 0);
  }
  const h = fixture(); Object.assign(h.db, { rpc: async () => ({ data: null, error: { message: "Unavailable" } }) });
  const a = audit(h); assert.equal((await a.handler(managerRequest("POST"))).status, 503); assert.equal(a.writes(), 0);
});

test("signature verification errors fail closed instead of trusting decoded JWT fields", async () => {
  const h = fixture(); Object.assign(h.db.auth, { getClaims: async () => ({ data: null, error: new Error("Invalid signature") }) });
  assert.equal((await proxyResult("/api/admin/users/list", h)).status, 503);
  assert.equal((await audit(h).handler(managerRequest("POST"))).status, 503);
});

test("initial credentials use a cryptographic generator with a minimum length", () => {
  const values = new Set(Array.from({ length: 50 }, () => randomPassword()));
  assert.equal(values.size, 50);
  for (const value of values) assert.equal(value.length, 20);
  assert.throws(() => randomPassword(8));
});

test("creating a manager forces first-login password replacement and audits without logging the password", async () => {
  const h = fixture();
  const route = loadManagerModule<{ POST: (r: Request) => Promise<Response> }>("app/api/admin/create-user/route.ts", h.mocks);
  const response = await route.POST(managerRequest("POST", { first_name: "Fixture", last_name: "Manager" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tempPassword.length, 20);
  assert.deepEqual(h.authWrites[0].app_metadata, { initial_password_required: true });
  assert.ok(!JSON.stringify(h.rpcs).includes(body.tempPassword));
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("initial password replacement affects only the verified caller and preserves other app metadata", async () => {
  const h = fixture(claims(), "player", { initial_password_required: true, preserved: "fixture" });
  const network: Array<{ url: string; init?: RequestInit }> = [];
  const route = loadManagerModule<{ POST: (r: Request) => Promise<Response> }>("app/api/auth/initial-password/route.ts", {
    ...h.mocks, fetch: async (url: string, init?: RequestInit) => { network.push({ url, init }); return Response.json({ id: actor }); },
  });
  const request = (body: object) => managerRequest("POST", body);
  assert.equal((await route.POST(request({ password: "short", confirmPassword: "short" }))).status, 400);
  assert.equal(network.length, 0); assert.equal(h.authWrites.length, 0);
  const response = await route.POST(request({ password: "personal-fixture-password", confirmPassword: "personal-fixture-password", userId: target }));
  assert.equal(response.status, 200);
  assert.equal(h.authWrites[0].id, actor);
  assert.deepEqual(h.authWrites[0].patch.app_metadata, { initial_password_required: false, preserved: "fixture" });
  assert.deepEqual(await response.json(), { ok: true });
});

test("a rejected personal password never clears the required flag", async () => {
  const h = fixture(claims(), "player", { initial_password_required: true });
  const route = loadManagerModule<{ POST: (r: Request) => Promise<Response> }>("app/api/auth/initial-password/route.ts", {
    ...h.mocks, fetch: async () => Response.json({ error: "Password rejected" }, { status: 422 }),
  });
  assert.equal((await route.POST(managerRequest("POST", { password: "fixture-password", confirmPassword: "fixture-password" }))).status, 400);
  assert.equal(h.authWrites.length, 0);
});
