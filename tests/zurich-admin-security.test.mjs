import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { zurichSecurityBatch } from '../scripts/security/zurich-security-batch.mjs';

const db = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001';
const source = zurichSecurityBatch();
const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role authenticator; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key);
    create table public.app_admins(user_id uuid primary key);
    create table public.clubs(id uuid primary key);
    create table public.organizations(id uuid primary key);
    create table public.organization_members(id uuid primary key);
    create table public.legal_documents(id int primary key,scope text,club_id uuid,document_key text,active boolean);
    create table public.legal_versions(id int primary key);
    create table public.validation_exercises(id int primary key,illustration_url text);
    insert into auth.users values('${admin}'); insert into profiles values('${admin}'); insert into app_admins values('${admin}');
    insert into legal_documents select n,'platform',null,'synthetic_legal_'||n,true from generate_series(1,3) n;
    insert into legal_versions select generate_series(1,4);
    insert into validation_exercises select n,case when n<=40 then 'https://soivxpdcilgltbjbpimt.supabase.co/storage/v1/object/public/synthetic/'||n||'.png' end from generate_series(1,60) n;
    alter table profiles enable row level security; alter table app_admins enable row level security;
    create policy existing_profiles on profiles to authenticated using(true) with check(true);
    grant usage on schema public,auth,storage to authenticated,anon,service_role; grant all on profiles,app_admins to authenticated,service_role;`);
  for (const [table, count] of [['legal_club_templates',3],['rules_series',12],['rules_cards',72],['rules_questions',216],['etiquette_themes',12],['etiquette_cards',36],['validation_sections',4],['training_volume_default_targets',10]]) {
    await db.exec(`create table public.${table}(id int primary key); insert into ${table} select generate_series(1,${count});`);
  }
});
after(async () => db.close());

test('prepared Zurich file is the exact guarded batch and preserves the clean reference base', async () => {
  assert.equal(readFileSync('docs/security/apply-zurich-admin-security.sql','utf8'), source);
  await db.exec(source.replace(/^commit;$/m,'-- Held open for rollback after assertions.'));
  assert.equal(await scalar('select count(*) from organizations'), 0);
  assert.equal(await scalar('select count(*) from clubs'), 0);
  assert.equal(await scalar('select count(*) from auth.users'), 1);
  assert.equal(await scalar('select count(*) from legal_versions'), 4);
  assert.equal(await scalar('select count(*) from rules_cards'), 72);
  assert.equal(await scalar('select count(*) from validation_exercises'), 60);
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.admin_security_events'::regclass"), true);
  assert.equal(await scalar('select count(*) from platform_contact_settings'), 1);
  assert.equal(await scalar("select count(*) from pg_policies where tablename='platform_contact_settings' and permissive='RESTRICTIVE'"), 3);
  await db.exec('rollback');
});

test('a club or academy blocks Zurich without deleting it or changing the schema', async () => {
  await db.exec("insert into organizations values('00000000-0000-4000-8000-000000000010')");
  await assert.rejects(db.exec(source), /Base is not club free: organizations/);
  await db.exec('rollback');
  assert.equal(await scalar('select count(*) from organizations'), 1);
  assert.equal(await scalar("select to_regclass('public.admin_security_events') is null"), true);
  await db.exec('delete from organizations');
});

test('an empty contact singleton is initialized while an already configured address is preserved', async () => {
  for (const configured of [false, true]) {
    await db.exec(readFileSync('supabase/migrations/20261106_platform_contact_settings.sql','utf8'));
    await db.exec(configured ? "update platform_contact_settings set contact_email='custom@example.invalid'" : 'delete from platform_contact_settings');
    try {
      await db.exec(source.replace(/^commit;$/m,'-- Held open for rollback.'));
      assert.equal(await scalar('select contact_email from platform_contact_settings'), configured ? 'custom@example.invalid' : 'info@activitee.golf');
      assert.equal(await scalar('select count(*) from auth.users'), 1);
    } finally {
      await db.exec('rollback');
      await db.exec('drop table platform_contact_settings');
    }
  }
});

test('an additional user blocks Zurich rather than cleaning up the user', async () => {
  await db.exec("insert into auth.users values('00000000-0000-4000-8000-000000000002')");
  await assert.rejects(db.exec(source), /exactly the existing superadmin identity/);
  await db.exec('rollback');
  assert.equal(await scalar('select count(*) from auth.users'), 2);
  await db.exec(`delete from auth.users where id<>'${admin}'`);
});

test('incomplete reference catalogs block Zurich without importing replacement records', async () => {
  await db.exec('delete from rules_cards where id=72');
  await assert.rejects(db.exec(source), /catalogs are incomplete/);
  await db.exec('rollback');
  assert.equal(await scalar('select count(*) from rules_cards'), 71);
  assert.equal(await scalar("select to_regclass('public.admin_security_events') is null"), true);
  await db.exec('insert into rules_cards values(72)');
});

test('an unrelated PostgREST hook causes complete rollback of the Zurich changes', async () => {
  await db.exec("alter role authenticator set pgrst.db_pre_request='public.existing_security_hook'");
  await assert.rejects(db.exec(source), /Existing PostgREST pre-request hook/);
  await db.exec('rollback');
  assert.equal(await scalar("select to_regclass('public.admin_security_events') is null"), true);
  assert.equal(await scalar('select count(*) from auth.users'), 1);
  assert.equal(await scalar('select count(*) from legal_versions'), 4);
});
