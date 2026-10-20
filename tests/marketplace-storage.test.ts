import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isMarketplaceImagePath, signMarketplaceImagePaths } from "../lib/marketplaceStorage.ts";
import { normalizePlayerDocumentMimeType, playerDocumentSignatureMatches } from "../lib/playerDocumentPolicy.ts";
const require = createRequire(import.meta.url);

test("signed images cannot target another listing, owner or private document path", async () => {
  const calls: unknown[] = [];
  const db = { storage: { from: (bucket: string) => ({ createSignedUrls: async (paths: string[], ttl: number) => {
    calls.push([bucket, paths, ttl]);
    return { data: paths.map(path => ({ path, signedUrl: `https://storage.example/signed/${path}` })), error: null };
  } }) } };
  const urls = await signMarketplaceImagePaths(db as unknown as Parameters<typeof signMarketplaceImagePaths>[0], [
    { item_id: "item", path: "owner/item/photo.jpg" }, { item_id: "item", path: "other/item/photo.jpg" },
    { item_id: "item", path: "owner/other/photo.jpg" }, { item_id: "item", path: "player-documents/private/file.pdf" },
    { item_id: "item", path: "owner/item/../private.jpg" }, { item_id: "unknown", path: "owner/unknown/photo.jpg" },
  ], new Map([["item", "owner"]]));
  assert.deepEqual([...urls.keys()], ["owner/item/photo.jpg"]);
  assert.deepEqual(calls, [["marketplace", ["owner/item/photo.jpg"], 900]]);
  assert.equal(isMarketplaceImagePath("owner/item/..", "owner", "item"), false);
});

function setup(options: { owner?: string; club?: string; path?: string; denied?: boolean; insertFails?: boolean; suspended?: boolean } = {}) {
  const uploads: unknown[] = []; const removals: string[][] = []; const inserts: Record<string, unknown>[] = [];
  let removedRow = false;
  const db = {
    storage: { from: () => ({
      upload: async (path: string, _bytes: unknown, config: unknown) => { uploads.push([path, config]); return { error: null }; },
      remove: async (paths: string[]) => { removals.push(paths); return { error: null }; },
      createSignedUrls: async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: `https://storage.example/signed/${path}` })), error: null }),
    }) },
    from: (table: string) => {
      const row = table === "marketplace_items" ? { id: "item", user_id: options.owner ?? "owner", club_id: options.club ?? "club" } : { id: "image", path: options.path ?? "owner/item/photo.jpg" };
      let inserted: Record<string, unknown> | undefined;
      const query = {
        select: () => query, eq: () => query,
        insert: (values: Record<string, unknown>) => { inserted = values; inserts.push(values); return query; },
        delete: () => { removedRow = true; return query; },
        maybeSingle: async () => ({ data: row, error: null }),
        single: async () => options.insertFails ? { error: { message: "insert failed" } } : { data: { id: "new-image", ...inserted }, error: null },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      }; return query;
    },
  };
  const mocks: Record<string, unknown> = {
    "../../_lib": { createAdminClient: () => db, resolveMarketplaceAccess: async () => options.denied ? { error: "Forbidden", status: 403 } : { effectiveUserId: "owner", clubIds: ["club"] } },
    "@/lib/marketplaceStorage": { MARKETPLACE_BUCKET: "marketplace", MARKETPLACE_IMAGE_MAX_BYTES: 5242880, isMarketplaceImagePath, signMarketplaceImagePaths },
    "@/lib/playerDocumentPolicy": { normalizePlayerDocumentMimeType, playerDocumentSignatureMatches },
    "@/lib/server/marketplaceSafety": { marketplaceSafetyContext: async () => ({ canPublish: () => !options.suspended }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/player/marketplace/[itemId]/images/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  type Handler = (req: Request, ctx: { params: Promise<{ itemId: string }> }) => Promise<Response>;
  const compiled = { exports: {} as { POST: Handler; DELETE: Handler } };
  new Function("require", "module", "exports", code)((id: string) => mocks[id] ?? require(id), compiled, compiled.exports);
  const context = { params: Promise.resolve({ itemId: "item" }) };
  return { uploads, removals, inserts, removedRow: () => removedRow,
    upload: (file = new File([Uint8Array.from([255,216,255,0,0,0,0,0,0,0,0,0])], "mobile.jpg", { type: "" })) => {
      const body = new FormData(); body.append("file", file); body.append("sort_order", "2");
      return compiled.exports.POST(new Request("https://activitee.app/api/player/marketplace/item/images", { method: "POST", headers: { Authorization: "Bearer test" }, body }), context);
    },
    remove: () => compiled.exports.DELETE(new Request("https://activitee.app/api/player/marketplace/item/images", { method: "DELETE", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify({ image_id: "image", path: "injected/other/file.jpg" }) }), context),
  };
}

test("mobile uploads use normalized MIME and return a signed image URL", async () => {
  const result = setup(); const response = await result.upload();
  assert.equal(response.status, 200);
  assert.match((await response.json()).publicUrl, /storage.example\/signed/);
  assert.equal(result.inserts[0].sort_order, 2);
  assert.equal((result.uploads[0] as [string, { contentType: string }])[1].contentType, "image/jpeg");
});

test("other owners, other clubs and unauthorized actors cannot upload or delete", async () => {
  for (const options of [{ owner: "other" }, { club: "other" }, { denied: true }]) {
    const result = setup(options);
    assert.equal((await result.upload()).status, 403);
    assert.equal((await result.remove()).status, 403);
    assert.equal(result.uploads.length, 0); assert.equal(result.removals.length, 0);
  }
});

test("spoofed files are rejected and failed image inserts clean up their own upload", async () => {
  const invalid = setup(); assert.equal((await invalid.upload(new File(["<html>fake image</html>"], "fake.jpg", { type: "image/jpeg" }))).status, 400);
  assert.equal(invalid.uploads.length, 0);
  const failed = setup({ insertFails: true }); assert.equal((await failed.upload()).status, 400);
  assert.equal(failed.removals.length, 1);
});

test("suspended sellers cannot upload new images", async () => {
  const result = setup({ suspended: true });
  assert.equal((await result.upload()).status, 403);
  assert.equal(result.uploads.length, 0);
});

test("image deletion uses the stored path and rejects cross-listing paths", async () => {
  const own = setup(); assert.equal((await own.remove()).status, 200);
  assert.deepEqual(own.removals, [["owner/item/photo.jpg"]]); assert.equal(own.removedRow(), true);
  const foreign = setup({ path: "owner/other/private.jpg" }); assert.equal((await foreign.remove()).status, 409);
  assert.equal(foreign.removals.length, 0);
});
