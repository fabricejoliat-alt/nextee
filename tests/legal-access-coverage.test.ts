import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { legalRouteKind } from "../lib/legalRouteCoverage.ts";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

const businessApis = ["/api/player/documents", "/api/coach/events/event", "/api/manager/events/create",
  "/api/parent/children", "/api/messages/threads", "/api/rules/overview", "/api/etiquette/overview", "/api/profile/custom-fields"];

function proxyFixture(options: { enabled?: boolean; missing?: boolean; failure?: boolean; actor?: string | null; invalidBearer?: boolean } = {}) {
  const cookieActor = options.actor === undefined ? "coach" : options.actor;
  const { db } = managerDatabase({ club_members: [],
    legal_enforcement_control: [{ singleton: true, enabled: options.enabled !== false }] });
  const checked: string[] = [];
  const proxy = loadManagerModule<{ proxy: (req: unknown) => Promise<Response>; config: { matcher: string[] } }>("proxy.ts", {
    "next/server": { NextResponse: {
      next: () => Object.assign(new Response(), { cookies: { set() {} } }),
      json: Response.json,
      redirect: (url: URL) => new Response(null, { status: 307, headers: { location: String(url) } }),
    } },
    "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: cookieActor ? { id: cookieActor } : null } }) } }) },
    "@supabase/supabase-js": { createClient: () => ({ ...db, auth: { getUser: async () => ({ data: { user: options.invalidBearer ? null : { id: "bearer-actor" } }, error: options.invalidBearer ? {} : null }) } }) },
    "@/lib/server/legalRequirements": { loadLegalGateStatus: async (_db: unknown, actor: string) => {
      checked.push(actor);
      if (options.failure) throw new Error("Unavailable");
      return { enabled: options.enabled !== false,
        missing: options.enabled === false ? [] : options.missing ? [{ document_id: "fictional-terms", version_id: "v2" }] : [] };
    } },
  });
  return { checked, config: proxy.config, run: (path: string, token?: string, method = "GET") => {
    const url = new URL(path, "https://test.invalid");
    return proxy.proxy({ url: String(url), method, nextUrl: Object.assign(url, { clone: () => new URL(url) }),
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}), cookies: { getAll: () => [] } });
  } };
}

test("old clients calling business APIs directly receive a non-cacheable refusal", async () => {
  const fixture = proxyFixture({ missing: true });
  for (const path of businessApis) {
    const response = await fixture.run(path, "fictional-token");
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, "LEGAL_ACTION_REQUIRED", path);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/, path);
  }
  assert.deepEqual(fixture.checked, businessApis.map(() => "bearer-actor"));
});

test("page refusal redirects to the recovery surface; accepted requests also avoid HTTP caching", async () => {
  for (const page of ["/player", "/coach/calendar", "/manager/events"]) {
    const denied = await proxyFixture({ missing: true }).run(page);
    assert.equal(denied.status, 307);
    assert.equal(denied.headers.get("location"), "https://test.invalid/legal/my");
    assert.match(denied.headers.get("cache-control") ?? "", /no-store/);
  }
  const granted = await proxyFixture().run("/api/rules/overview", "fixture-token");
  assert.equal(granted.status, 200);
  assert.match(granted.headers.get("cache-control") ?? "", /no-store/);
});

test("gate off reads its database switch and leaves business routes reachable", async () => {
  const off = proxyFixture({ enabled: false });
  for (const path of businessApis) assert.equal((await off.run(path)).status, 200);
  assert.deepEqual(off.checked, []);
  for (const path of ["/legal/my", "/api/legal/decide", "/api/legal/data-request", "/api/auth/me",
    "/player/help", "/player/consent-required", "/api/player/consent", "/api/admin/legal"]) {
    assert.equal(legalRouteKind(path), null, path);
  }
});

test("unavailable legal state and invalid bearer tokens fail closed", async () => {
  assert.equal((await proxyFixture({ failure: true }).run("/api/etiquette/overview")).status, 503);
  const invalid = proxyFixture({ invalidBearer: true });
  const denied = await invalid.run("/api/rules/overview", "invalid");
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(invalid.checked, []);
  assert.equal((await proxyFixture({ actor: null }).run("/api/profile/custom-fields")).status, 401);
});

test("every classified API is reached by the actual Next matcher", () => {
  const { config } = proxyFixture();
  for (const path of businessApis) assert(config.matcher.some((pattern) => pattern.endsWith("/:path*")
    ? path.startsWith(pattern.slice(0, -7)) : pattern === path), path);
  assert.equal(legalRouteKind("/api/rules-admin/overview"), null);
});

test("metadata drift rejects an otherwise accepted current version; only the latest version is checked", async () => {
  const tables = {
    legal_enforcement_control: [{ singleton: true, enabled: true }], // Isolated stub, never a database write.
    club_members: [{ user_id: "coach", club_id: "A", role: "coach", is_active: true }], app_admins: [],
    legal_documents: [{ id: "terms", document_key: "terms", kind: "terms", scope: "club", club_id: "A", audience_roles: ["coach"],
      action_kind: "accept", required: true, active: true, applicability: { rule: "all_members" } }],
    legal_versions: [{ id: "v1", document_id: "terms", version_number: 1 }, { id: "v2", document_id: "terms", version_number: 2 }],
    legal_current_state: [{ beneficiary_id: "coach", document_id: "terms", version_id: "v2", club_scope: "A", decision: "accepted", conflict: false }],
  };
  const { db } = managerDatabase(tables);
  const calls: unknown[] = [];
  let matching = true;
  const database = { ...db, rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: matching, error: null }; } };
  const requirements = loadManagerModule<{ loadMissingLegalActions: (db: unknown, actor: string) => Promise<unknown[]> }>("lib/server/legalRequirements.ts", {});
  assert.deepEqual(await requirements.loadMissingLegalActions(database, "coach"), []);
  matching = false;
  await assert.rejects(() => requirements.loadMissingLegalActions(database, "coach"), /metadata changed/);
  assert.deepEqual(calls, [1, 2].map(() => ({ name: "legal_version_matches_document", args: { p_document: "terms", p_version: "v2" } })));
});

test("coverage batch scopes match actual TEST columns and preserve permission boundaries", () => {
  const inventory = JSON.parse(readFileSync("docs/legal/evidence/20261005-coverage-inventory.json", "utf8"));
  const manifest = JSON.parse(readFileSync("docs/legal/evidence/20261005-coverage-batch-manifest.json", "utf8"));
  const sql = readFileSync("supabase/migrations/20261103_legal_access_coverage.sql", "utf8");
  for (const [table, value] of Object.entries(manifest.policies) as [string, { expression: string }][]) {
    const relation = inventory.find((r: { category: string; item: string }) => r.category === "relation" && r.item === table);
    assert(relation.details.rls, table);
    const column = value.expression.match(/\((\w+)\)/)?.[1];
    if (column) assert(relation.details.columns.some((c: { name: string }) => c.name === column), `${table}.${column}`);
    assert(sql.includes(`on public.${table} as restrictive for all to anon,authenticated`), table);
  }
  assert.doesNotMatch(sql, /enabled\s*=\s*true|disable row level security|drop constraint|insert into public\.legal_/i);
  assert.match(sql, /legal_version_matches_document\(d.id,v.id\)/);
  assert.match(sql, /m.is_active and m.role in \('coach','manager'\)/);
});
