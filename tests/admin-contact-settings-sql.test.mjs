import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const batch=readFileSync(new URL('../docs/security/apply-contact-settings.sql',import.meta.url),'utf8');
async function fixture(security=true) {
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 insert into auth.users values('00000000-0000-4000-8000-000000000001');
 create table public.profiles(id uuid primary key,name text); insert into public.profiles values('00000000-0000-4000-8000-000000000001','preserved');`);
 if(security)await db.exec(`create function public.application_session_ready() returns boolean language sql as $$select true$$;
 create function public.application_mutation_ready() returns boolean language sql as $$select true$$;`);
 return db;
}
test('missing contact dependency is created, remains server-only, and preserves records/address on reapplication',async()=>{
 const db=await fixture();
 try {
  await db.exec(batch);
  assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from pg_policies where tablename='platform_contact_settings' and permissive='RESTRICTIVE'")).rows[0].n,3);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from platform_contact_settings'),/permission denied/);
  await assert.rejects(db.query("update platform_contact_settings set contact_email='unwanted@example.invalid'"),/permission denied/);
  await db.exec('reset role; set role service_role');
  await db.exec("update platform_contact_settings set contact_email='custom@example.invalid',updated_by='00000000-0000-4000-8000-000000000001' where singleton");
  await db.exec('reset role');
  await db.exec(batch);
  const row=(await db.query('select contact_email,updated_by from platform_contact_settings')).rows[0];
  assert.equal(row.contact_email,'custom@example.invalid');
  assert.equal(row.updated_by,'00000000-0000-4000-8000-000000000001');
 }finally{await db.close();}
});
test('repair refuses an environment without the security dependencies and rolls back',async()=>{
 const db=await fixture(false);
 try {
  await assert.rejects(db.exec(batch),/Apply Admin security first/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.platform_contact_settings') as relation")).rows[0].relation,null);
 }finally{await db.close();}
});
