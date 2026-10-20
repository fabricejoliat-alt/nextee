import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { marketplaceSafetyContext, marketplaceSafetyHeaders, marketplaceReportReasons, marketplaceUuid } from "../lib/server/marketplaceSafety.ts";

const require = createRequire(import.meta.url);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Row = Record<string, unknown>;
function database(seed: Record<string, Row[]>) {
  const tables = structuredClone(seed);
  return { tables, from(table: string) {
    let filters: Array<(row: Row) => boolean> = [], operation = "read", payload: Row = {};
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      gte: () => query,
      insert: (value: Row) => { operation = "insert"; payload = value; return query; },
      upsert: (value: Row) => { operation = "insert"; payload = value; return query; },
      delete: () => { operation = "delete"; return query; },
      maybeSingle: async () => ({ data: (tables[table] ?? []).find(row => filters.every(filter => filter(row))) ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        const rows = tables[table] ?? [];
        const data = rows.filter(row => filters.every(filter => filter(row)));
        if (operation === "insert") tables[table] = [...rows, payload];
        if (operation === "delete") tables[table] = rows.filter(row => !filters.every(filter => filter(row)));
        return Promise.resolve({ data, error: null, count: data.length }).then(resolve);
      },
    };
    return query;
  } };
}

test("server visibility enforces approval, both block directions, child context and club suspension", async () => {
  const db = database({
    marketplace_blocks: [{ blocker_id: id(3), blocked_id: id(2) }, { blocker_id: id(4), blocked_id: id(6) }],
    marketplace_suspensions: [{ user_id: id(5), club_id: id(10) }],
  });
  const ctx = await marketplaceSafetyContext(db as never, { viewerUserId: id(6), effectiveUserId: id(3), clubIds: [id(10), id(11)] });
  const listing = { id: id(20), user_id: id(1), club_id: id(10), is_active: true, moderation_status: "approved" };
  assert.equal(ctx.visible(listing), true);
  assert.equal(ctx.visible({ ...listing, moderation_status: "pending" }), false);
  assert.equal(ctx.visible({ ...listing, moderation_status: "rejected" }), false);
  assert.equal(ctx.visible({ ...listing, is_active: false }), false);
  for (const user of [2,4,5]) assert.equal(ctx.visible({ ...listing, user_id: id(user) }), false);
  assert.equal(ctx.visible({ ...listing, user_id: id(5), club_id: id(11) }), true);
  const suspended = await marketplaceSafetyContext(db as never, { viewerUserId: id(5), effectiveUserId: id(3), clubIds: [id(10), id(11)] });
  assert.equal(suspended.canPublish(id(10)), false);
  assert.equal(suspended.canPublish(id(11)), true);
});

function safetyRoute(options: { denied?: boolean; otherClub?: boolean; status?: string; recipient?: number } = {}) {
  const db = database({
    marketplace_items: [{ id: id(20), user_id: id(2), club_id: id(options.otherClub ? 11 : 10), is_active: true, moderation_status: options.status ?? "approved" }],
    marketplace_blocks: [], marketplace_suspensions: [], marketplace_reports: [],
    marketplace_contact_messages: [{ id: id(25), club_id: id(10), sender_id: id(4), recipient_id: id(options.recipient ?? 3) }],
  });
  const source = readFileSync(new URL("../app/api/player/marketplace/safety/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} as { POST: (req: Request) => Promise<Response> } };
  const mocks: Record<string, unknown> = {
    "../_lib": { createAdminClient: () => db, resolveMarketplaceAccess: async () => options.denied ? { error: "Forbidden", status: 403 }
      : { viewerUserId: id(6), effectiveUserId: id(3), clubIds: [id(10)] } },
    "@/lib/server/marketplaceSafety": { marketplaceSafetyContext, marketplaceSafetyHeaders, marketplaceReportReasons, marketplaceUuid },
  };
  new Function("require", "module", "exports", code)((key: string) => mocks[key] ?? require(key), compiled, compiled.exports);
  return { db, call: (input: Row, token = true) => compiled.exports.POST(new Request("https://activitee.app/api/player/marketplace/safety", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer fixture" } : {}) },
    body: JSON.stringify({ item_id: id(20), ...input }),
  })) };
}
test("report attribution and parent blocks use authenticated identities, never submitted actor IDs", async () => {
  const route = safetyRoute();
  assert.equal((await route.call({ action: "report", reason: "fraud", details: "Fictitious test", reporter_id: id(1), subject_id: id(1) })).status, 200);
  assert.equal(route.db.tables.marketplace_reports[0].reporter_id, id(6));
  assert.equal(route.db.tables.marketplace_reports[0].subject_id, id(2));
  assert.equal((await route.call({ action: "block", blocker_id: id(1), blocked_id: id(1) })).status, 200);
  assert.deepEqual(route.db.tables.marketplace_blocks[0], { blocker_id: id(3), blocked_id: id(2), created_by: id(6) });
  assert.equal((await route.call({ action: "unblock", user_id: id(2) })).status, 200);
  assert.equal(route.db.tables.marketplace_blocks.length, 0);
});
test("unauthorized children, other clubs and unpublished listings cannot be reported or blocked", async () => {
  for (const options of [{ denied: true }, { otherClub: true }, { status: "pending" }]) {
    for (const action of ["block", "report"]) {
      const route = safetyRoute(options);
      const response = await route.call({ action, reason: "fraud", details: "" });
      assert.ok([403,404].includes(response.status));
      assert.equal(route.db.tables.marketplace_blocks.length, 0);
      assert.equal(route.db.tables.marketplace_reports.length, 0);
    }
  }
  assert.equal((await safetyRoute().call({ action: "block" }, false)).status, 401);
  assert.equal((await safetyRoute().call({ action: "report", reason: "invented", details: "" })).status, 400);
});

test("a recipient can report or block a message sender without any seller listing", async () => {
  const route = safetyRoute();
  assert.equal((await route.call({ action: "report", message_id: id(25), reason: "harassment", details: "Fictitious" })).status, 200);
  assert.equal(route.db.tables.marketplace_reports[0].item_id, null);
  assert.equal(route.db.tables.marketplace_reports[0].message_id, id(25));
  assert.equal(route.db.tables.marketplace_reports[0].subject_id, id(4));
  assert.equal((await route.call({ action: "block", message_id: id(25) })).status, 200);
  assert.equal(route.db.tables.marketplace_blocks[0].blocked_id, id(4));
  const otherRecipient = safetyRoute({ recipient: 2 });
  assert.equal((await otherRecipient.call({ action: "block", message_id: id(25) })).status, 404);
  assert.equal(otherRecipient.db.tables.marketplace_blocks.length, 0);
});
