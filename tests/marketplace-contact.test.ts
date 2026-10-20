import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { marketplaceContactEmail, marketplaceContactTextAllowed } from "../lib/marketplaceContact.ts";

const require = createRequire(import.meta.url);
function setup(options: { club?: string; email?: string; active?: boolean; denied?: boolean; providerOk?: boolean; blocked?: boolean; status?: string; recentCount?: number } = {}) {
  const sent: Record<string, unknown>[] = [];
  const source = readFileSync(new URL("../app/api/player/marketplace/[itemId]/contact/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} as { POST: (req: Request, ctx: { params: Promise<{ itemId: string }> }) => Promise<Response> } };
  const mocks: Record<string, unknown> = {
    "@/lib/marketplaceContact": { marketplaceContactEmail, marketplaceContactTextAllowed },
    "@/lib/server/marketplaceSafety": { marketplaceUuid: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value), marketplaceSafetyContext: async () => ({
      visible: () => !options.blocked && (options.status ?? "approved") === "approved",
    }) },
    "@/lib/server/marketplaceMessageNotifications": { processMarketplaceMessagePushes: async () => ({ processed: 1 }) },
    "../../_lib": {
      createAdminClient: () => ({ rpc: async () => (options.recentCount ?? 0) >= 3 ? { data: null, error: { code: "P0001" } } : { data: "stored-message", error: null }, from: (table: string) => { const query = {
        is: () => query, select: () => query, eq: () => query, gte: () => query, insert: () => query, update: () => query,
        single: async () => ({ data: { id: "stored-message" }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: table === "marketplace_contact_messages" ? options.recentCount ?? 0 : 0, error: null }).then(resolve),
        maybeSingle: async () => ({ data: { id: "listing", user_id: "seller", title: "Putter", club_id: options.club ?? "club-a", is_active: options.active ?? true, contact_email: options.email ?? "seller@example.com" }, error: null }),
      }; return query; } }),
      resolveMarketplaceAccess: async () => options.denied ? { error: "Forbidden", status: 403 } : { clubIds: ["club-a"], viewerUserId: "viewer" },
    },
  };
  new Function("require", "module", "exports", "process", "fetch", code)(
    (id: string) => mocks[id] ?? require(id), compiled, compiled.exports,
    { env: { NODE_ENV: "production", BREVO_API_KEY: "test-key", MAIL_FROM: "ActiviTee <sender@example.com>" } },
    async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return { ok: options.providerOk ?? true }; },
  );
  const call = (input: Record<string, unknown> = {}, token = true) => compiled.exports.POST(new Request("https://activitee.app/api/player/marketplace/listing/contact", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer test" } : {}) },
    body: JSON.stringify({ reply_email: "buyer@example.com", subject: "About the putter", message: "Hello, is the putter still available?", ...input }),
  }), { params: Promise.resolve({ itemId: "listing" }) });
  return { call, sent };
}

test("contact sends only to the stored seller and honors the editable reply address", async () => {
  const { call, sent } = setup();
  assert.equal((await call({ to: "injected@example.com", reply_email: "alternate@example.com" })).status, 200);
  assert.deepEqual(sent[0].to, [{ email: "seller@example.com" }]);
  assert.deepEqual(sent[0].replyTo, { email: "alternate@example.com" });
  assert.deepEqual(sent[0].sender, { name: "ActiviTee", email: "sender@example.com" });
  assert.match(String(sent[0].textContent), /marketplace\/messages\?message=stored-message/);
});

test("unauthorized accounts and other clubs cannot send a seller email", async () => {
  for (const options of [{ club: "other-club" }, { denied: true }]) {
    const { call, sent } = setup(options);
    assert.ok([403, 404].includes((await call()).status));
    assert.equal(sent.length, 0);
  }
  const { call, sent } = setup();
  assert.equal((await call({}, false)).status, 401);
  assert.equal(sent.length, 0);
});

test("missing seller email, inactive listings and invalid forms never send mail", async () => {
  for (const options of [{ email: "member.123@noemail.local" }, { email: "" }, { active: false }]) {
    const { call, sent } = setup(options);
    assert.equal((await call()).status, 409);
    assert.equal(sent.length, 0);
  }
  const { call, sent } = setup();
  for (const input of [{ reply_email: "member.123@noemail.local" }, { subject: "bad\r\nheader" }, { message: "short" }, { message: "x".repeat(17000) }]) {
    assert.ok([400, 413].includes((await call(input)).status));
  }
  assert.equal(sent.length, 0);
});

test("email failures preserve the successfully stored in-app message and durable limits are enforced", async () => {
  const failed = setup({ providerOk: false });
  const response = await failed.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, message_id: "stored-message", email_sent: false });
  const limited = setup({ recentCount: 3 });
  assert.equal((await limited.call()).status, 429);
  assert.equal(limited.sent.length, 0);
});

test("blocked sellers and pending or rejected listings cannot be contacted, including by direct URL", async () => {
  for (const options of [{ blocked: true }, { status: "pending" }, { status: "rejected" }]) {
    const { call, sent } = setup(options);
    assert.equal((await call()).status, 409);
    assert.equal(sent.length, 0);
  }
});

test("real email defaults are preserved and technical or blank defaults are empty", () => {
  assert.equal(marketplaceContactEmail(" member.42@NOEMAIL.LOCAL "), "");
  assert.equal(marketplaceContactEmail(null), "");
  assert.equal(marketplaceContactEmail(" buyer@example.com "), "buyer@example.com");
});


test("unsafe message text is filtered before delivery and durable limits survive a fresh server", async () => {
  const filtered = setup();
  assert.equal((await filtered.call({ message: "Visit https://example.test for the payment" })).status, 400);
  assert.equal(filtered.sent.length, 0);
  const limited = setup({ recentCount: 3 });
  assert.equal((await limited.call()).status, 429);
  assert.equal(limited.sent.length, 0);
  assert.equal(marketplaceContactTextAllowed("Le putter", "Bonjour, je souhaite acheter ce putter."), true);
  assert.equal(marketplaceContactTextAllowed("Message", "Je vais te tuer demain"), false);
});
