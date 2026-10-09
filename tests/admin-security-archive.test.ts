import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validatePgArchive } = require("../scripts/security/validate-pg-archive.mjs");

test("archive validation uses a private file rather than stdin, then removes it", () => {
  const dump = Buffer.alloc(10 * 1024 * 1024, "synthetic-test-data");
  let archivePath = "";
  const output = validatePgArchive(dump, "test-pg-restore", {}, (bin: string, args: string[], options: { input?: Buffer }) => {
    assert.equal(bin, "test-pg-restore");
    assert.equal(args[0], "--list"); archivePath = args[1];
    assert.equal(options.input, undefined);
    assert.equal(statSync(archivePath).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(archivePath)).mode & 0o777, 0o700);
    assert.deepEqual(readFileSync(archivePath), dump);
    return Buffer.from("test archive TOC");
  });
  assert.equal(output.toString(), "test archive TOC");
  assert.equal(existsSync(dirname(archivePath)), false);
});

test("validation failures remove the temporary dump before propagating the error", () => {
  let archivePath = "";
  assert.throws(() => validatePgArchive(Buffer.from("synthetic archive"), "test-pg-restore", {}, (_bin: string, args: string[]) => {
    archivePath = args[1]; throw new Error("synthetic restore error");
  }), /synthetic restore error/);
  assert.equal(existsSync(dirname(archivePath)), false);
});

const realRestore = ["/opt/homebrew/opt/libpq/bin/pg_restore", "/opt/homebrew/bin/pg_restore"].find(existsSync);
test("real pg_restore rejects a large invalid archive with its diagnostic rather than EPIPE", { skip: !realRestore }, () => {
  // Intentionally invalid synthetic bytes; no real account or database data.
  assert.throws(() => validatePgArchive(Buffer.alloc(10 * 1024 * 1024), realRestore, process.env), (error: unknown) => {
    const result = error as { code?: string; status?: number; stderr?: Buffer };
    assert.notEqual(result.code, "EPIPE");
    assert.equal(result.status, 1);
    assert.match(result.stderr!.toString(), /pg_restore:/);
    return true;
  });
});
