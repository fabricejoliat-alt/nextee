import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";
import { organizationMessages } from "../lib/i18n/organizationMessages.ts";

function fixture(allowed = true) {
  const f = managerDatabase();
  const route = loadManagerModule<{ POST: (req: Request) => Promise<Response> }>("app/api/admin/organizations/route.ts", {
    "@/lib/server/adminAudit": { withAdminMutationAudit: (handler: unknown) => handler },
    "@/lib/server/organizationAccess": { organizationActor: async () => allowed ? { db: f.db, actor: { id: "admin" } } : null,
      organizationReply: (value: object, status = 200) => Response.json(value, { status }), organizationFailure: () => Response.json({ error: "Failed" }, { status: 400 }) },
  });
  return { f, call: (isDemo?: unknown) => route.POST(new Request("https://fixture.invalid/api/admin/organizations", { method: "POST", body: JSON.stringify({ name: "Fixture", slug: "fixture", org_type: "club", ...(isDemo !== undefined ? { is_demo: isDemo } : {}) }) })) };
}

test("only an authorized admin creation reaches the atomic demo-aware RPC", async () => {
  const denied = fixture(false);
  assert.equal((await denied.call(true)).status, 403);
  assert.equal(denied.f.rpcs.length, 0);
  const allowed = fixture();
  assert.equal((await allowed.call(true)).status, 201);
  assert.equal(allowed.f.rpcs[0].name, "create_organization_with_mode_checked");
  assert.equal(allowed.f.rpcs[0].args.p_is_demo, true);
});

test("missing demo flag defaults to real; string or null flags never reach the RPC", async () => {
  const regular = fixture(); await regular.call();
  assert.equal(regular.f.rpcs[0].args.p_is_demo, false);
  for (const value of ["false", "true", null, 1]) {
    const invalid = fixture();
    assert.equal((await invalid.call(value)).status, 400);
    assert.equal(invalid.f.rpcs.length, 0);
  }
});

test("demo control has complete labels, explanations and badges in all four languages", () => {
  for (const locale of ["fr", "en", "de", "it"] as const) {
    for (const key of ["demoMode", "demoHint", "demoBadge"]) assert.ok(organizationMessages[locale][`organization.${key}`]?.trim());
  }
});

test("settings save forwards strict demo status; old clients omit it and managers cannot save", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000003";
  for (const [allowed, value, expected] of [[true, true, 200], [true, undefined, 200], [true, "false", 400], [false, true, 403]] as const) {
    const f = managerDatabase({ app_admins: allowed ? [{ user_id: "admin" }] : [] }, { caller: "admin" });
    const route = loadManagerModule<{ PUT: (req: Request, context: { params: Promise<{ organizationId: string }> }) => Promise<Response> }>("app/api/admin/organizations/[organizationId]/settings/route.ts", {
      "@/lib/server/adminAudit": { withAdminMutationAudit: (handler: unknown) => handler },
      "@supabase/supabase-js": { createClient: () => f.db }, "next/server": { NextResponse: { json: Response.json } },
    });
    const req = new Request("https://fixture.invalid/api/admin/organizations/fixture/settings", { method: "PUT", headers: { Authorization: "Bearer fixture" }, body: JSON.stringify({ organization: { name: "Fixture", slug: "fixture", org_type: "club", is_active: true, ...(value !== undefined ? { is_demo: value } : {}) }, settings: {} }) });
    assert.equal((await route.PUT(req, { params: Promise.resolve({ organizationId }) })).status, expected);
    assert.equal(f.rpcs.length, expected === 200 ? 1 : 0);
    if (expected === 200) {
      assert.equal(f.rpcs[0].name, "save_organization_settings_checked");
      assert.equal(f.rpcs[0].args.p_values.is_demo, value);
      assert.equal(Object.hasOwn(f.rpcs[0].args.p_values, "is_demo"), value !== undefined);
    }
  }
});
