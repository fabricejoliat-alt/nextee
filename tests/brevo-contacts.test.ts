import { test } from "node:test";
import assert from "node:assert/strict";
import { brevoContactClient, brevoAttributes, BrevoContactError, contactEmailHash, suppressionEvent, secretMatches, retryDelay, brevoContactConfig, runBrevoContactSync } from "../lib/server/brevoContacts.ts";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";

function client(existing: object | null, writeStatus = 204) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return init?.method === "GET" ? Response.json(existing ?? {}, { status: existing ? 200 : 404 })
      : writeStatus === 204 ? new Response(null, { status: 204 }) : Response.json({ message: "private email must not leak" }, { status: writeStatus, headers: { "Retry-After": "900" } });
  };
  return { api: brevoContactClient("test-key", 42, transport), calls };
}
const attributes = { ACTIVITEE_ACTIVE: true, ACTIVITEE_ROLES: "|parent|coach|" };
test("initial import creates a directory contact without changing consent or enabling merges", async () => {
  const { api, calls } = client(null, 201);
  await api.sync("parent+golf@example.org", attributes, false);
  assert.equal(calls[0].url.endsWith("parent%2Bgolf%40example.org"), true);
  assert.deepEqual(calls[1].body, { email: "parent+golf@example.org", attributes, listIds: [42], updateEnabled: false });
});
test("existing blocklisted contact: update own attributes and remove only the dedicated list", async () => {
  const { api, calls } = client({ emailBlacklisted: true, listIds: [] });
  await api.sync("parent@example.org", attributes, false);
  assert.deepEqual(calls[1].body, { attributes, unlinkListIds: [42] });
  assert.equal(calls[1].method, "PUT");
});
test("local suppression prevents recreation and removes only the dedicated list for existing contacts", async () => {
  const absent = client(null);
  await absent.api.sync("parent@example.org", attributes, true);
  assert.equal(absent.calls.length, 1);
  const present = client({ listIds: [42, 99] });
  await present.api.sync("parent@example.org", attributes, true);
  assert.deepEqual(present.calls[1].body, { attributes, unlinkListIds: [42] });
});
test("departed/deleted account: clear own attributes, unlink list, preserve global contact and preferences", async () => {
  const { api, calls } = client({ listIds: [42, 99], emailBlacklisted: true });
  await api.sync("parent@example.org", { ACTIVITEE_ACTIVE: false }, false);
  const cleared = Object.fromEntries(Object.keys(brevoAttributes).map(key => [key, key === "ACTIVITEE_ACTIVE" ? false : ""]));
  assert.deepEqual(calls[1].body, { attributes: cleared, unlinkListIds: [42] });
  assert.equal(calls.some(call => call.method === "DELETE"), false);
  const absent = client(null);
  await absent.api.sync("parent@example.org", { ACTIVITEE_ACTIVE: false }, false);
  assert.equal(absent.calls.length, 1);
});
test("rate limit exposes only a safe status and honors provider backoff", async () => {
  const { api } = client({}, 429);
  await assert.rejects(api.sync("parent@example.org", attributes, false), cause => {
    assert.ok(cause instanceof BrevoContactError);
    assert.equal(cause.message, "BREVO_HTTP_429");
    assert.equal(retryDelay(0, cause.retryAfter), 900);
    return true;
  });
});
test("setup validates attribute types instead of silently dropping segmentation fields", async () => {
  const api = brevoContactClient("test", 42, async input => String(input).endsWith("/attributes")
    ? Response.json({ attributes: [{ name: "ACTIVITEE_ROLES", type: "number", category: "normal" }] })
    : Response.json({}));
  await assert.rejects(api.prepare(), /BREVO_ATTRIBUTE_TYPE_ACTIVITEE_ROLES/);
});
test("webhook normalization, suppression hashes and secrets", () => {
  assert.deepEqual(suppressionEvent({ email: " Parent@Example.org ", event: "unsubscribe" }), { email: "parent@example.org", reason: "unsubscribe" });
  assert.equal(suppressionEvent({ email: "bad", event: "spam" }), null);
  assert.equal(suppressionEvent({ email: "parent@example.org", event: "opened" }), null);
  assert.equal(contactEmailHash("Parent@Example.org "), contactEmailHash("parent@example.org"));
  assert.equal(secretMatches(null, undefined), false);
  assert.equal(secretMatches("Bearer a", "Bearer aa"), false);
  assert.equal(secretMatches("Bearer a", "Bearer a"), true);
  assert.equal(brevoContactConfig({ BREVO_CONTACTS_LIST_ID: "bad" }).listId, null);
  assert.equal(brevoContactConfig({ BREVO_CONTACTS_LIST_ID: "42" }).enabled, false);
});
test("cron rejects unauthorized requests before opening the database", async () => {
  const route = loadManagerModule<{ GET: (req: Request) => Promise<Response> }>("app/api/cron/brevo-contacts/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server/legalAccess": { legalDb: () => { throw new Error("must not open database"); }, legalNoStore: {} },
    "@/lib/server/brevoContacts": { secretMatches, runBrevoContactSync: () => { throw new Error("must not sync"); } },
  }, { CRON_SECRET: "cron-test" });
  assert.equal((await route.GET(new Request("https://example.org/api/cron/brevo-contacts"))).status, 401);
});

test("worker persists successes and rate-limit retry, stops the batch and releases the lease", async () => {
  const env = { BREVO_CONTACTS_SYNC_ENABLED: "true", BREVO_CONTACTS_LIST_ID: "42", BREVO_API_KEY: "test", BREVO_CONTACTS_WEBHOOK_SECRET: "secret" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const writes: { table: string; value: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const rows = ["a", "b", "c"].map(letter => ({ email: `${letter}@example.org`, user_ids: ["00000000-0000-4000-8000-000000000001"], attributes, desired_hash: letter, attempts: 0 }));
  const db = {
    rpc: async (name: string) => ({ data: name === "prepare_brevo_contact_sync" ? true : rows, error: null }),
    from: (table: string) => {
      let value: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query, or: () => query, limit: () => query,
        update: (data: Record<string, unknown>) => { value = data; return query; },
        eq: (key: string, data: unknown) => { filters[key] = data; return query; },
        then: (resolve: (value: object) => unknown) => {
          if (value) writes.push({ table, value, filters });
          return Promise.resolve({ data: table === "brevo_contact_suppressions" ? [] : null, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const network: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); network.push(url);
    if (url.endsWith("/attributes")) return Response.json({ attributes: Object.entries(brevoAttributes).map(([name, type]) => ({ name, type, category: "normal" })) });
    if (init?.method === "PUT" && url.includes("b%40")) return Response.json({}, { status: 429, headers: { "retry-after": "900" } });
    return init?.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ listIds: [42] });
  };
  try {
    assert.deepEqual(await runBrevoContactSync(db as never, transport), { status: "partial", processed: 1, failed: 1 });
    assert.equal(network.some(url => url.includes("c%40")), false);
    assert.equal(writes.find(write => write.filters.email === "a@example.org")?.value.synced_hash, "a");
    const failure = writes.find(write => write.filters.email === "b@example.org")!;
    assert.equal(failure.value.attempts, 1);
    assert.equal(failure.value.last_error, "BREVO_HTTP_429");
    assert.ok(Date.parse(String(failure.value.next_attempt_at)) > Date.now() + 890000);
    const release = writes.find(write => write.table === "brevo_contact_sync_control")!;
    assert.equal(release.value.lease_token, null);
    assert.ok(release.filters.lease_token);
    assert.ok(Date.parse(String(release.value.cooldown_until)) > Date.now() + 890000);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("authenticated webhook records only normalized suppression data and ignores tracking events", async () => {
  const recorded: object[] = [];
  const route = loadManagerModule<{ POST: (req: Request) => Promise<Response> }>("app/api/webhooks/brevo-contacts/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server/legalAccess": { legalDb: () => ({ rpc: async (name: string, args: object) => { recorded.push({ name, args }); return { error: null }; } }), legalNoStore: {} },
    "@/lib/server/brevoContacts": { secretMatches, suppressionEvent, contactEmailHash },
  }, { BREVO_CONTACTS_WEBHOOK_SECRET: "webhook-test" });
  const request = (body: string, authorized = true) => new Request("https://example.org/api/webhooks/brevo-contacts", { method: "POST",
    headers: authorized ? { Authorization: "Bearer webhook-test" } : {}, body });
  assert.equal((await route.POST(request("{}", false))).status, 401);
  assert.equal((await route.POST(request("invalid json"))).status, 400);
  assert.equal((await route.POST(request("x".repeat(66000)))).status, 413);
  assert.equal(recorded.length, 0);
  const response = await route.POST(request(JSON.stringify([{ event: "unsubscribe", email: " PARENT@example.org " }, { event: "opened", email: "parent@example.org" }])));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: 1 });
  assert.deepEqual(recorded, [{ name: "suppress_brevo_contact", args: { p_email: "parent@example.org", p_hash: contactEmailHash("parent@example.org"), p_reason: "unsubscribe" } }]);
});

test("admin preview and manual synchronization reject non-admins before reading contacts or sending data", async () => {
  const route = loadManagerModule<{ GET: (req: Request) => Promise<Response>; POST: (req: Request) => Promise<Response> }>("app/api/admin/brevo-contacts/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server/legalAccess": { legalDb: () => ({}), legalAdmin: async () => null, legalNoStore: {} },
    "@/lib/server/adminAudit": { withAdminMutationAudit: (handler: unknown) => handler },
    "@/lib/server/brevoContacts": { brevoContactConfig: () => { throw new Error("must not read config"); }, runBrevoContactSync: () => { throw new Error("must not sync"); } },
  });
  assert.equal((await route.GET(new Request("https://example.org/api/admin/brevo-contacts"))).status, 403);
  assert.equal((await route.POST(new Request("https://example.org/api/admin/brevo-contacts", { method: "POST" }))).status, 403);
});
