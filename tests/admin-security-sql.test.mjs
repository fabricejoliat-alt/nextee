import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001';
const player = '00000000-0000-4000-8000-000000000002';
const secondAdmin = '00000000-0000-4000-8000-000000000003';
const sql = readFileSync(new URL('../docs/security/apply-admin-security.sql', import.meta.url), 'utf8');
async function session(user, aal = 'aal1', extra = {}, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role, aal, amr: [{ method: 'totp', timestamp: Math.floor(Date.now()/1000) }], ...extra })]);
  await db.exec(`set role ${role}`);
}
async function scalar(sql, args = []) { return Object.values((await db.query(sql, args)).rows[0])[0]; }

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role authenticator; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table app_admins(user_id uuid primary key); alter table app_admins enable row level security;
    create policy legacy_admin_policy on app_admins for all to authenticated using(true) with check(true);
    create table profiles(id uuid primary key,name text); alter table profiles enable row level security;
    create policy legacy_profile_policy on profiles for all to authenticated using(true) with check(true);
    create table storage.objects(id uuid primary key,name text); alter table storage.objects enable row level security;
    create policy legacy_storage_policy on storage.objects for all to authenticated using(true) with check(true);
    grant all on app_admins,profiles,storage.objects to authenticated,service_role;
    insert into app_admins values('${admin}'),('${secondAdmin}');
    insert into profiles values('${admin}','Admin'),('${player}','Player');
    insert into storage.objects values(gen_random_uuid(),'fixture.png');`);
  await db.exec(sql);
  await db.exec(sql); // Reapplication must preserve data and permissions.
});
after(async () => { await db.close(); });

test('aal1 admin cannot read application rows or Storage, and can see only its own role bootstrap', async () => {
  await session(admin);
  assert.equal(await scalar('select count(*)::int from profiles'), 0);
  assert.equal(await scalar('select count(*)::int from storage.objects'), 0);
  assert.equal(await scalar('select count(*)::int from app_admins'), 1);
  assert.equal(await scalar('select public.is_app_admin($1)', [admin]), false);
  assert.equal(await scalar('select public.is_superadmin()'), false);
  await db.exec(`delete from app_admins where user_id='${admin}'`);
  assert.equal(await scalar('select count(*)::int from app_admins'), 1);
});

test('aal2 admin keeps access; ordinary users keep their existing policies', async () => {
  await session(admin, 'aal2');
  assert.equal(await scalar('select count(*)::int from profiles'), 2);
  assert.equal(await scalar('select public.is_app_admin($1)', [admin]), true);
  assert.equal(await scalar('select public.is_app_admin($1)', [secondAdmin]), false);
  await session(player);
  assert.equal(await scalar('select count(*)::int from profiles'), 2);
  assert.equal(await scalar('select public.application_session_ready()'), true);
});

test('first-login password flag blocks direct rows and direct RPC entry', async () => {
  await session(player, 'aal1', { app_metadata: { initial_password_required: true } });
  assert.equal(await scalar('select count(*)::int from profiles'), 0);
  await db.exec("set request.method='POST'; set request.path='/rpc/fixture';");
  await assert.rejects(db.query('select public.check_application_session()'), /Additional authentication required/);
});

test('pre-request hook blocks aal1 SECURITY DEFINER calls and allows verified sessions', async () => {
  await session(admin);
  await db.exec("set request.method='POST'; set request.path='/rpc/fixture';");
  await assert.rejects(db.query('select public.check_application_session()'), /Additional authentication required/);
  await db.exec("set request.method='GET'; set request.path='/app_admins';");
  await db.query('select public.check_application_session()');
  await session(admin, 'aal2');
  await db.query('select public.check_application_session()');
});

test('stale aal2 keeps reads but blocks direct modifications and RPC writes', async () => {
  await session(admin, 'aal2', { amr: [{ method: 'totp', timestamp: 1 }] });
  assert.equal(await scalar('select count(*)::int from profiles'), 2);
  await db.exec(`update profiles set name='Unwanted' where id='${admin}'`);
  assert.equal(await scalar(`select name from profiles where id='${admin}'`), 'Admin');
  await db.exec("set request.method='POST'; set request.path='/rpc/fixture';");
  await assert.rejects(db.query('select public.check_application_session()'), /Recent MFA verification required/);
});

test('durable audit is service-only, append-only, and validates the actor', async () => {
  const request = '00000000-0000-4000-8000-000000000099';
  const append = () => db.query("select record_admin_security_event($1,$2,'POST /api/admin/users/update',$3,'started',null)", [admin, request, player]);
  await session(admin, 'aal2');
  await assert.rejects(append(), /permission denied/);
  await session(admin, 'aal2', {}, 'service_role');
  await append();
  assert.equal(await scalar('select count(*)::int from admin_security_events'), 1);
  await assert.rejects(db.query('delete from admin_security_events'), /permission denied/);
  await assert.rejects(db.query("update admin_security_events set action='rewritten'"), /permission denied/);
  await assert.rejects(db.query("select record_admin_security_event($1,gen_random_uuid(),'fixture',null,'started',null)", [player]), /Forbidden/);
  await session(player);
  assert.equal(await scalar('select count(*)::int from admin_security_events'), 0);
});

test('pre-existing data is preserved and a different hook prevents partial migration', async () => {
  await db.exec('reset role');
  assert.equal(await scalar('select count(*)::int from profiles'), 2);
  assert.equal(await scalar('select count(*)::int from app_admins'), 2);
  await db.exec("alter role authenticator set pgrst.db_pre_request='public.existing_hook'");
  await assert.rejects(db.exec(sql), /Existing PostgREST pre-request hook must be preserved/);
  await db.exec('rollback');
  assert.equal(await scalar('select count(*)::int from admin_security_events'), 1);
});
