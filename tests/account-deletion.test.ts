import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadManagerModule, managerDatabase, managerRequest } from "./helpers/managerRouteHarness.ts";
import { executeAccountDeletion, receiptHash, publicDeletionStatus, sendDeletionConfirmation } from "../lib/server/accountDeletion.ts";

const user = "00000000-0000-4000-8000-000000000002";
const secret = "ab".repeat(32);
type Routes = { POST: (r: Request) => Promise<Response>; DELETE: (r: Request) => Promise<Response> };
function requestRoute({ authenticated = true, correctPassword = true, limited = false, synthetic = false } = {}) {
  const database = managerDatabase();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  database.db.rpc = async (name, args) => {
    calls.push({ name, args });
    return { error: null, data: name === "reserve_account_deletion_attempt" ? !limited
      : { id: "request", status: "requested", contact_email: "private", user_id: user, receipt_hash: "private" } } as never;
  };
  const identity = { id: user, email: synthetic ? "junior@noemail.local" : "parent@example.test", email_confirmed_at: "2026-01-01" };
  const route = loadManagerModule<Routes>("app/api/legal/account-deletion/route.ts", {
    "@/lib/server/legalAccess": { legalDb: () => database.db, legalActor: async () => authenticated ? identity : null },
    "@supabase/supabase-js": { createClient: () => ({
      auth: { signInWithPassword: async (credentials: { email: string }) => {
        assert.equal(credentials.email, identity.email);
        return correctPassword ? { data: { user: identity }, error: null } : { data: {}, error: { message: "Invalid" } };
      }, signOut: async () => ({ error: null }) },
    }) },
  });
  return { route, calls };
}
test("deletion requests are bound to the authenticated account and rechecked password", async () => {
  const r = requestRoute();
  const response = await r.route.POST(managerRequest("POST", { confirm: true, password: "fixture-password", receipt: secret, user_id: "someone-else", child_id: "child", email: "attacker@example.test", locale: "fr" }));
  assert.equal(response.status, 201);
  const call = r.calls.find((c) => c.name === "request_account_deletion")!;
  assert.equal(call.args.p_user, user);
  assert.equal(call.args.p_email, "parent@example.test");
  assert.equal(call.args.p_receipt_hash, receiptHash(secret));
  const body = await response.json();
  assert.equal(body.request.receipt_hash, undefined);
  assert.equal(body.request.contact_email, undefined);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});
test("unauthenticated, unconfirmed, wrong-password and rate-limited requests never enqueue deletion", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ correctPassword: false }, 403], [{ limited: true }, 429]] as const) {
    const r = requestRoute(options);
    assert.equal((await r.route.POST(managerRequest("POST", { confirm: true, password: "fixture", receipt: secret }))).status, status);
    assert.equal(r.calls.some((c) => c.name === "request_account_deletion"), false);
  }
  const r = requestRoute();
  assert.equal((await r.route.POST(managerRequest("POST", { password: "fixture", receipt: secret }))).status, 400);
  assert.equal(r.calls.length, 0);
});
test("juniors without email can request deletion and receive a tracking receipt", async () => {
  const r = requestRoute({ synthetic: true });
  assert.equal((await r.route.POST(managerRequest("POST", { confirm: true, password: "fixture", receipt: secret }))).status, 201);
  assert.equal(r.calls.find((c) => c.name === "request_account_deletion")!.args.p_email, null);
});
test("tracking does not reveal identity, address, hash or internal failure details", () => {
  assert.deepEqual(publicDeletionStatus({ id: "x", status: "completed", requested_at: "a", due_at: "b", completed_at: "c",
    contact_email: "private", user_id: "private", receipt_hash: "private", last_error: "private" }),
  { id: "x", status: "completed", requested_at: "a", due_at: "b", completed_at: "c" });
});
test("Storage failure never reaches finalization; a resumed run completes only after physical deletion", async () => {
  const calls: string[] = [];
  let removed = false, failStorage = true;
  const db = createClient("https://fixture.invalid", "test", { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.includes("/storage/v1/object/")) {
        if (failStorage) return Response.json({ message: "Storage failed" }, { status: 500 });
        removed = true; return Response.json([]);
      }
      if (url.pathname.endsWith("/account_deletion_files") && init?.method !== "PATCH")
        return Response.json(removed ? [] : [{ bucket_id: "private", object_path: "target/file.pdf" }]);
      return Response.json(null);
    },
  } });
  await assert.rejects(executeAccountDeletion(db, "request", "admin"), /Storage/);
  assert.equal(calls.some((c) => c.includes("finish_account_deletion")), false);
  failStorage = false;
  assert.deepEqual(await executeAccountDeletion(db, "request", "admin"), { completed: true });
  assert.ok(calls.some((c) => c.includes("finish_account_deletion")));
});
test("confirmation mail is forbidden before deletion and failed delivery stays retryable", async () => {
  let status = "processing", sent = 0, updates = 0;
  const db = createClient("https://fixture.invalid", "test", { auth: { persistSession: false }, global: {
    fetch: async (_input, init) => {
      if (init?.method === "PATCH") { updates++; return Response.json(null); }
      return Response.json({ id: "request", status, locale: "fr", contact_email: "fixture@example.test", confirmation_sent_at: null });
    },
  } });
  const transport: typeof fetch = async () => { sent++; return new Response(null, { status: 503 }); };
  await assert.rejects(sendDeletionConfirmation(db, "request", transport), /not completed/);
  assert.equal(sent, 0);
  status = "completed";
  const old = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = "fixture-key";
  try {
    await assert.rejects(sendDeletionConfirmation(db, "request", transport), /delivery failed/);
    assert.equal(updates, 0);
    await sendDeletionConfirmation(db, "request", async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.to, [{ email: "fixture@example.test" }]);
      assert.match(body.textContent, /terminée/);
      return new Response(null, { status: 201 });
    });
    assert.equal(updates, 1);
  } finally { if (old === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = old; }
});
