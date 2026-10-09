import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const runner = new URL("../scripts/security/test-admin-security.mjs", import.meta.url);
const require = createRequire(runner);
const { openBackup } = require("../organizations/backup-envelope.mjs");
const code = ts.transpileModule(readFileSync(runner, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const passphrase = "synthetic-backup-passphrase";

function fixture(mode = "--apply", failure = "", credentials = true) {
  const actions: string[] = [], logs: string[] = [];
  const files = new Map<string, string | Buffer>();
  const env = credentials ? { PGPASSWORD: "synthetic-db-password", ACTIVITEE_BACKUP_PASSPHRASE: passphrase } : {};
  const state = { argv: ["node", "runner", mode], env, exitCode: 0, exit: (code: number) => { throw new Error(`exit:${code}`); } };
  const contactRepair = ["--plan-contact", "--repair-contact"].includes(mode);
  const batchPath = contactRepair ? "docs/security/apply-contact-settings.sql" : "docs/security/apply-admin-security.sql";
  const batch = readFileSync(new URL(`../${batchPath}`, import.meta.url), "utf8");
  const archiveCheck = () => {
    actions.push("archive_check");
    if (failure === "archive_check") throw new Error("synthetic archive validation failure");
  };
  const mockRequire = (name: string) => {
    if (name === "./validate-pg-archive.mjs") return { validatePgArchive: archiveCheck };
    if (name === "node:fs") return {
      readFileSync: (path: string) => { assert.equal(path, batchPath); return batch; }, existsSync: () => true, mkdirSync: () => {},
      writeFileSync: (path: string, value: string | Buffer, options: { mode: number }) => {
        assert.equal(options.mode, 0o600); files.set(path, value); actions.push(`write:${path}`);
      },
    };
    if (name === "node:child_process") return { execFileSync: (bin: string, args: string[], options: { input?: string | Buffer; env: Record<string, string> }) => {
      assert.equal(options.env.PGSSLMODE, "verify-full");
      if (!bin.endsWith("pg_restore")) assert.ok(args.includes("--host=db.wizbeuuvjibmmuxyynly.supabase.co"));
      const operation = bin.endsWith("pg_dump") ? "dump" : bin.endsWith("pg_restore") ? "archive_check" : options.input === batch ? "migration" : String(options.input).includes("'preflight'") ? "preflight" : "postflight";
      actions.push(operation);
      if (operation === failure) throw new Error(`synthetic ${operation} failure`);
      if (operation === "dump") return Buffer.from("synthetic archive bytes");
      if (operation === "archive_check") return Buffer.from("synthetic archive list");
      if (operation === "migration") return "admin_security_committed\n";
      return JSON.stringify({ target: "wizbeuuvjibmmuxyynly", [operation]: "passed", admins: 1, organizations: 7, users: 12, legal_versions: 19 });
    } };
    return require(name);
  };
  return {
    actions, logs, files, state,
    run() { return new Function("require", "exports", "process", "console", code)(mockRequire, {}, state, { log: (line: unknown) => logs.push(String(line)), error: (line: unknown) => logs.push(String(line)) }); },
  };
}

test("TEST rollout plan makes no connection or write; credentials are mandatory before execution", () => {
  const plan = fixture("--plan");
  assert.throws(() => plan.run(), /exit:0/);
  assert.deepEqual(plan.actions, []);
  const missing = fixture("--apply", "", false);
  assert.throws(() => missing.run(), /hidden password entry/);
  assert.deepEqual(missing.actions, []);
});

test("failed preflight or archive validation prevents all database changes", () => {
  for (const failure of ["preflight", "dump", "archive_check"]) {
    const f = fixture("--apply", failure); f.run();
    assert.equal(f.state.exitCode, 1);
    assert.ok(!f.actions.includes("migration"));
    assert.equal(f.files.size, 0);
  }
});

test("encrypted backup precedes the migration and contains no plaintext file artifact", () => {
  const f = fixture(); f.run();
  assert.equal(f.state.exitCode, 0);
  const backup = [...f.files.keys()].find(path => path.endsWith(".enc"))!;
  assert.ok(f.actions.indexOf(`write:${backup}`) < f.actions.indexOf("migration"));
  const payload = openBackup(f.files.get(backup), passphrase);
  assert.equal(payload.project, "wizbeuuvjibmmuxyynly");
  assert.equal(Buffer.from(payload.postgresql.dump, "base64").toString(), "synthetic archive bytes");
  assert.equal(payload.restore_verified, false);
  assert.equal(payload.storage_blob_bytes_included, false);
  assert.ok([...f.files.keys()].every(path => path.endsWith(".enc") || path.endsWith(".sha256") || path.endsWith(".json")));
  assert.ok(!f.logs.join("\n").includes("synthetic-db-password"));
  assert.ok(!f.logs.join("\n").includes(passphrase));
  const receipt = [...f.files.entries()].find(([path]) => path.endsWith(".json"))!;
  assert.equal(JSON.parse(String(receipt[1])).browser_verified, false);
});

test("failed postflight reports a committed migration without replaying it or writing a success receipt", () => {
  const f = fixture("--apply", "postflight"); f.run();
  assert.equal(f.state.exitCode, 1);
  assert.equal(f.actions.filter(action => action === "migration").length, 1);
  assert.ok(f.logs.some(line => line.includes("Migration committed, but postflight failed")));
  assert.ok(![...f.files.keys()].some(path => path.endsWith(".json")));
});

test("contact repair targets only its companion batch after encrypted backup", () => {
  const plan = fixture("--plan-contact");
  assert.throws(() => plan.run(), /exit:0/);
  assert.deepEqual(plan.actions, []);
  const missing = fixture("--repair-contact", "", false);
  assert.throws(() => missing.run(), /hidden password entry/);
  const repair = fixture("--repair-contact"); repair.run();
  assert.equal(repair.state.exitCode, 0);
  const backup = [...repair.files.keys()].find(path => path.endsWith(".enc"))!;
  assert.ok(backup.includes("test-before-contact-settings"));
  assert.ok(repair.actions.indexOf(`write:${backup}`) < repair.actions.indexOf("migration"));
  assert.equal(openBackup(repair.files.get(backup), passphrase).label, "before-contact-settings");
});
