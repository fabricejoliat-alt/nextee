import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizationDatabase } from './helpers/organizationDatabase.mjs';
import { prerequisiteInventoryQuery,existingProtectedTables,testPrerequisiteSource } from '../scripts/organizations/test-prerequisites.mjs';
import { fingerprintQuery,preservationAssertion,protectedTables } from '../scripts/organizations/preservation.mjs';
import { historyCheckpoint,historyAssertion } from '../scripts/organizations/test-history-preservation.mjs';
import { migrationBundle,withoutTransaction } from '../scripts/organizations/migration-bundle.mjs';
const admin='20000000-0000-4000-8000-000000000001';
const club='20000000-0000-4000-8000-000000000002';
async function populatedLegacy(db){
 await db.exec("set request.jwt.claim.role='service_role';");
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[admin,'admin@prerequisites.fixtures.invalid']);
 await db.query("insert into public.profiles(id,first_name,last_name,username) values($1,'Fixture','Admin','prerequisite.admin')",[admin]);
 await db.query('insert into public.app_admins(user_id) values($1)',[admin]);
 await db.query("insert into public.clubs(id,name,slug) values($1,'Existing Club','prerequisite-club')",[club]);
 await db.query("insert into public.training_volume_settings(organization_id,coach_training_assistance_enabled) values($1,true) on conflict(organization_id) do update set coach_training_assistance_enabled=true",[club]);
 await db.query("insert into public.training_volume_targets(organization_id,ftem_code,level_label,handicap_label,minutes_inseason,minutes_offseason,sort_order) values($1,'F1','Club custom target','54',37,41,10) on conflict(organization_id,ftem_code) do update set level_label='Club custom target',minutes_inseason=37,minutes_offseason=41",[club]);
 const doc=(await db.query(`insert into public.legal_documents(document_key,kind,purpose_key,scope,audience_roles,action_kind,required,active,applicability,created_by)
 values('prerequisite_privacy','privacy','privacy.notice','platform',array['admin'],'acknowledge',true,true,'{"status":"approved","rule":"all_members"}',$1) returning id`,[admin])).rows[0].id;
 const translations=Object.fromEntries(['fr','en','de','it'].map(locale=>[locale,{title:'Existing privacy',body:'Published fixture text',action_label:'OK',status:'approved',source_revision:1}]));
 await db.query("insert into public.legal_drafts(document_id,source_revision,change_summary,allowed_variables,translations,updated_by) values($1,1,'Reviewed fixture','{}',$2,$3)",[doc,translations,admin]);
 await db.query('select public.publish_legal_draft($1,$2)',[doc,admin]);
 const presentation=(await db.query("select public.present_legal_document($1,$2,$2,'admin','fr') id",[doc,admin])).rows[0].id;
 await db.query("select public.decide_legal_document($1,$2,'acknowledged',gen_random_uuid())",[presentation,admin]);
}
async function preparedBatch(db){
 const inventory=(await db.query(prerequisiteInventoryQuery())).rows[0].inventory;
 const before=(await db.query(fingerprintQuery(existingProtectedTables(inventory)))).rows[0].fingerprints;
 return {inventory,before,sql:historyCheckpoint()+withoutTransaction(readFileSync('supabase/bootstrap/organization-remodel-preflight.sql','utf8'))
  +testPrerequisiteSource(inventory)+migrationBundle()+historyAssertion()+preservationAssertion(before)
  +withoutTransaction(readFileSync('supabase/bootstrap/organization-remodel-postflight.sql','utf8'))};
}
test('Raw TEST schema: both absent catalogs are seeded atomically, club FTEM and published legal evidence preserved',async()=>{
 const db=await organizationDatabase({migrate:false,prerequisites:false,beforeMigrations:populatedLegacy});
 try{
  const {inventory,before,sql}=await preparedBatch(db);
  assert.equal(inventory.tables.training_volume_default_targets,false);
  assert.equal(inventory.tables.legal_club_templates,false);
  await db.exec('begin;'+sql);
  assert.equal((await db.query('select count(*)::int n from public.training_volume_default_targets')).rows[0].n,10);
  assert.equal((await db.query("select count(*)::int n from public.legal_organization_templates,jsonb_each(translations) tr where tr.value->>'status'='needs_review'")).rows[0].n,12);
  assert.deepEqual((await db.query(fingerprintQuery(existingProtectedTables(inventory)))).rows[0].fingerprints,before);
  await db.exec("update public.training_volume_targets set minutes_inseason=999 where ftem_code='F1';");
  await assert.rejects(()=>db.exec(historyAssertion()),/TEST history changed: public.training_volume_targets/);
  await db.exec('rollback;');
  assert.equal((await db.query("select to_regclass('public.training_volume_default_targets') is null and to_regclass('public.legal_club_templates') is null and to_regclass('public.player_guardian_scopes') is null clean")).rows[0].clean,true);
  await db.exec('begin;'+sql+'commit;');
  assert.equal((await db.query('select minutes_inseason from public.training_volume_targets where organization_id=$1 and ftem_code=$2',[club,'F1'])).rows[0].minutes_inseason,37);
  const newClub=(await db.query("select public.create_organization_checked($1,'New fixture club','new-prerequisite-club','club') id",[admin])).rows[0].id;
  assert.equal((await db.query('select count(*)::int n from public.training_volume_targets where organization_id=$1',[newClub])).rows[0].n,10);
  assert.equal((await db.query('select count(*)::int n from public.legal_versions')).rows[0].n,1);
 }finally{await db.close();}
});
test('Existing catalogs and seed function: preserve custom defaults, templates and existing club targets',async()=>{
 const db=await organizationDatabase({migrate:false,beforeMigrations:populatedLegacy});
 try{
  await db.exec("update public.training_volume_default_targets set minutes_inseason=123,level_label='Custom default' where ftem_code='F1';");
  const seed=(await db.query("select pg_get_functiondef('public.seed_new_club_training_volume()'::regprocedure) definition")).rows[0].definition;
  const {inventory,before,sql}=await preparedBatch(db);
  assert.equal(inventory.tables.legal_club_templates,true);
  await db.exec('begin;'+sql+'commit;');
  assert.deepEqual((await db.query(fingerprintQuery())).rows[0].fingerprints,before);
  assert.equal((await db.query("select pg_get_functiondef('public.seed_new_club_training_volume()'::regprocedure) definition")).rows[0].definition,seed);
  assert.equal((await db.query("select minutes_inseason from public.training_volume_default_targets where ftem_code='F1'")).rows[0].minutes_inseason,123);
 }finally{await db.close();}
});
test('Only the two known missing reference catalogs are optional; missing published evidence stops preparation',()=>{
 const inventory={tables:Object.fromEntries(protectedTables.map(name=>[name,true])),ftem_seed_function:true};
 inventory.tables.legal_versions=false;
 assert.throws(()=>existingProtectedTables(inventory),/Required TEST table missing: public.legal_versions/);
 assert.throws(()=>fingerprintQuery(['untrusted_table']),/Invalid protected catalog selection/);
});
