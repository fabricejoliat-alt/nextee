import test from "node:test";
import assert from "node:assert/strict";
import { trainingDetailRead } from "../lib/trainingDetailRead.ts";

test("a transient mobile network failure is retried once", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { if (++calls === 1) throw new TypeError("Load failed"); return Response.json({ id: "session" }); };
  try { assert.deepEqual(await trainingDetailRead("/detail", "token", new AbortController().signal), { id: "session" }); assert.equal(calls, 2); }
  finally { globalThis.fetch = original; }
});
test("authorization failures are not retried", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 403 }); };
  try { await assert.rejects(trainingDetailRead("/detail", "token", new AbortController().signal), { status: 403 }); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
test("persistent server failures stop after two attempts", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
  try { await assert.rejects(trainingDetailRead("/detail", "token", new AbortController().signal), { status: 503 }); assert.equal(calls, 2); }
  finally { globalThis.fetch = original; }
});
test("navigation cancellation stops without retry", async () => {
  const original = globalThis.fetch; let calls = 0; const controller = new AbortController();
  globalThis.fetch = async () => { calls++; controller.abort(); throw new DOMException("Aborted", "AbortError"); };
  try { await assert.rejects(trainingDetailRead("/detail", "token", controller.signal), { name: "AbortError" }); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
