import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase, managerRequest } from "./helpers/managerRouteHarness.ts";

function fixture(message?: string, admin = true) {
  const { db, mocks, rpcs, writes } = managerDatabase({
    app_admins: admin ? [{ user_id: "admin" }] : [],
  }, { caller: "admin", rpcError: message ? { message } : undefined });
  const userHeaders: unknown[] = [];
  const route = loadManagerModule<{ PATCH: (req: Request) => Promise<Response> }>("app/api/admin/etiquette/route.ts", {
    ...mocks,
    "@supabase/supabase-js": { createClient: (_url: string, _key: string, options: { global?: { headers?: unknown } }) => {
      if (options.global?.headers) userHeaders.push(options.global.headers);
      return db;
    } },
    "@/lib/server/adminAudit": { withAdminMutationAudit: (handler: unknown) => handler },
  });
  return { rpcs, writes, userHeaders, publish: () => route.PATCH(managerRequest("PATCH", { action: "publish", themeId: "theme-1" }, "admin-session")) };
}

test("missing account documents return an actionable legal refusal without retrying publication", async () => {
  const f = fixture("Legal validation required");
  const response = await f.publish();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "LEGAL_ACTION_REQUIRED", code: "LEGAL_ACTION_REQUIRED" });
  assert.deepEqual(f.rpcs, [{ name: "etiquette_publish_theme", args: { p_theme_id: "theme-1" } }]);
  assert.deepEqual(f.userHeaders, [{ Authorization: "Bearer admin-session" }]);
  assert.deepEqual(f.writes, []);
});

test("editorial approval failures remain distinct from account-document validation", async () => {
  const message = "Three complete, approved cards are required";
  const response = await fixture(message).publish();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: message });
});

test("a successful guarded publication is reported as published", async () => {
  const response = await fixture().publish();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { published: true });
});

test("non-admin accounts cannot invoke the publication function", async () => {
  const f = fixture(undefined, false);
  assert.equal((await f.publish()).status, 403);
  assert.deepEqual(f.rpcs, []);
  assert.deepEqual(f.writes, []);
});
