import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizationDatabase } from './helpers/organizationDatabase.mjs';
import { migrationBundle,withoutTransaction } from '../scripts/organizations/migration-bundle.mjs';
import { historyCheckpoint,historyAssertion } from '../scripts/organizations/test-history-preservation.mjs';
import { fingerprintQuery,preservationAssertion } from '../scripts/organizations/preservation.mjs';
test('All 17 migrations and postflight are inside one transaction; rollback restores the original schema',async()=>{
 const db=await organizationDatabase({migrate:false});
 try{
  const before=(await db.query(fingerprintQuery())).rows[0].fingerprints;
  await db.exec('begin;'+historyCheckpoint()+migrationBundle()+historyAssertion()+withoutTransaction(readFileSync('supabase/bootstrap/organization-remodel-postflight.sql','utf8')));
  await db.exec(preservationAssertion(before));
  assert.deepEqual((await db.query(fingerprintQuery())).rows[0].fingerprints,before);
  assert.equal((await db.query("select to_regclass('public.academy_roster_entries') is not null present")).rows[0].present,true);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.academy_roster_entries') is null absent")).rows[0].absent,true);
  assert.equal((await db.query("select to_regclass('public.organization_migration_baseline') is null absent")).rows[0].absent,true);
 }finally{await db.close();}
});
