import assert from "node:assert/strict";
import test from "node:test";
import { uploadDocumentWithProgress } from "../lib/uploadDocumentWithProgress.ts";

class FakeRequest {
  static last: FakeRequest;
  headers: Record<string, string> = {};
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  status = 200;
  responseText = "";
  timeout = 0;
  body: unknown;
  method = "";
  url = "";
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  constructor() { FakeRequest.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.body = body; }
}

test("mobile files use validated MIME and report actual byte progress before acceptance", async () => {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeRequest as unknown as typeof XMLHttpRequest;
  try {
    const file = new File(["phone-video"], "swing.mov", { type: "" });
    const progress: number[] = [];
    const promise = uploadDocumentWithProgress("https://storage.example/signed", file, "video/quicktime", p => progress.push(p));
    const request = FakeRequest.last;
    assert.equal(request.method, "PUT");
    assert.equal(request.headers["Content-Type"], "video/quicktime");
    assert.equal(request.headers["x-upsert"], "false");
    assert.equal(request.body, file);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 35, total: 100 });
    request.upload.onprogress?.({ lengthComputable: false, loaded: 70, total: 0 });
    assert.deepEqual(progress, [35]);
    request.onload?.();
    await promise;
    assert.deepEqual(progress, [35, 100]);
  } finally { globalThis.XMLHttpRequest = original; }
});

test("storage rejection and interrupted connections reject the transfer", async () => {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeRequest as unknown as typeof XMLHttpRequest;
  try {
    const file = new File(["image"], "photo.jpg");
    const rejected = uploadDocumentWithProgress("https://storage.example/signed", file, "image/jpeg", () => {});
    FakeRequest.last.status = 413;
    FakeRequest.last.responseText = JSON.stringify({ message: "Maximum size exceeded" });
    FakeRequest.last.onload?.();
    await assert.rejects(rejected, /Maximum size exceeded/);
    for (const event of ["onerror", "ontimeout", "onabort"] as const) {
      const transfer = uploadDocumentWithProgress("https://storage.example/signed", file, "image/jpeg", () => {});
      FakeRequest.last[event]?.();
      await assert.rejects(transfer);
    }
  } finally { globalThis.XMLHttpRequest = original; }
});
