import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.COACH_SECURITY_PGLITE_PATH;
test("preparation acknowledgements are isolated by coach, private by default and versioned", {
  skip: !runtime && "Set COACH_SECURITY_PGLITE_PATH for the isolated PostgreSQL test",
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(runtime).href);
  const db = new PGlite(); t.after(() => db.close());
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table profiles(id uuid primary key);
    create table coach_training_preparation_insights(
      target_event_id uuid, player_id uuid, source_fingerprint text, primary key(target_event_id,player_id));
    insert into profiles values('${uuid(1)}'),('${uuid(2)}');
    insert into coach_training_preparation_insights values('${uuid(3)}','${uuid(4)}','${"a".repeat(64)}');
  `);
  const migration = readFileSync(new URL("../supabase/migrations/20261007_coach_preparation_reads.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const policies = await db.query("select relrowsecurity from pg_class where relname = 'coach_training_preparation_reads'");
  assert.equal(policies.rows[0].relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const result = await db.query("select has_table_privilege($1, 'coach_training_preparation_reads', $2) as allowed", [role, privilege]);
      assert.equal(result.rows[0].allowed, false);
    }
  }
  await db.exec(`
    set role service_role;
    insert into coach_training_preparation_reads(target_event_id,player_id,coach_id,source_fingerprint)
      values('${uuid(3)}','${uuid(4)}','${uuid(1)}','${"a".repeat(64)}'),
        ('${uuid(3)}','${uuid(4)}','${uuid(2)}','${"a".repeat(64)}');
    reset role;
  `);
  assert.equal((await db.query("select count(*)::int as n from coach_training_preparation_reads")).rows[0].n, 2);
  await assert.rejects(db.exec(`insert into coach_training_preparation_reads(target_event_id,player_id,coach_id,source_fingerprint)
    values('${uuid(3)}','${uuid(4)}','${uuid(1)}','bad')`));
  await db.exec(`update coach_training_preparation_insights set source_fingerprint='${"b".repeat(64)}'`);
  assert.equal((await db.query(`select count(*)::int as n from coach_training_preparation_reads r
    join coach_training_preparation_insights i using(target_event_id,player_id)
    where r.source_fingerprint=i.source_fingerprint`)).rows[0].n, 0);
  await db.exec("delete from coach_training_preparation_insights");
  assert.equal((await db.query("select count(*)::int as n from coach_training_preparation_reads")).rows[0].n, 0);
});
