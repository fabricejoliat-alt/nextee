import assert from "node:assert/strict";
import test from "node:test";
import { readUploadedDocumentPrefix } from "../lib/readUploadedDocumentPrefix.ts";

test("media validation returns 512 bytes even if stream cancellation never resolves", async () => {
  const original = globalThis.fetch;
  let options: RequestInit | undefined;
  let cancelled = false;
  globalThis.fetch = (async (_url, init) => {
    options = init;
    return { ok: true, body: { getReader: () => ({
      read: async () => ({ done: false, value: new Uint8Array(4096).fill(42) }),
      cancel: () => { cancelled = true; return new Promise(() => {}); },
    }) } } as unknown as Response;
  }) as typeof fetch;
  try {
    const result = await readUploadedDocumentPrefix("https://storage.example/media");
    assert.equal(result.length, 512);
    assert.equal(result[511], 42);
    assert.equal(cancelled, true);
    assert.deepEqual(options?.headers, { Range: "bytes=0-511" });
    assert.equal(options?.signal?.aborted, true);
  } finally { globalThis.fetch = original; }
});

test("small files are read to completion and storage failures do not pass validation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("small file")) as typeof fetch;
  try {
    assert.equal(new TextDecoder().decode(await readUploadedDocumentPrefix("https://storage.example/file")), "small file");
    globalThis.fetch = (async () => new Response("Not found", { status: 404 })) as typeof fetch;
    await assert.rejects(readUploadedDocumentPrefix("https://storage.example/missing"), /Unable to inspect/);
  } finally { globalThis.fetch = original; }
});
