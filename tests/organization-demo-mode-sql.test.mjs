import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { organizationDemoBatch } from '../scripts/security/organization-demo-batch.mjs';

const db = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001';
const manager = '00000000-0000-4000-8000-000000000002';
const core = readFileSync('supabase/migrations/20261110_organization_core.sql', 'utf8');
const create = core.slice(core.indexOf('create function public.create_organization_checked'), core.lastIndexOf('commit;'));
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
let demo;
async function session(role) { await db.exec(`reset role; set request.jwt.claim.role='${role}'; set role ${role};`); }

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    grant usage on schema auth,public to anon,authenticated,service_role;
    create table app_admins(user_id uuid primary key);
    insert into app_admins values('${admin}');
    create table organizations(id uuid primary key default gen_random_uuid(),name text,slug text unique,org_type text,is_active boolean default true,country_code text,region_code text);
    create table organization_settings(organization_id uuid primary key references organizations,settings jsonb,updated_by uuid,updated_at timestamptz);
    create table profiles(id uuid primary key,name text);
    insert into profiles values('${manager}','Existing manager');
    grant all on organizations to authenticated,service_role;
    create function public.organization_require_actor(p_actor uuid,p_org uuid default null,p_admin_only boolean default false) returns void
    language plpgsql security definer set search_path=public,pg_temp as $$begin
      if auth.role() is distinct from 'service_role' or not exists(select 1 from app_admins where user_id=p_actor) then raise exception 'Forbidden'; end if;
    end $$;
    insert into organizations(name,slug,org_type) values('Existing real club','existing-real','club');`);
  await db.exec(create);
  await db.exec(organizationDemoBatch());
});
after(async () => db.close());

test('migration defaults existing clubs to real and creates demo atomically through the checked admin operation', async () => {
  await session('service_role');
  assert.equal(await scalar("select is_demo from organizations where slug='existing-real'"), false);
  demo = await scalar("select create_organization_with_mode_checked($1,'Demo club','demo-club','club',true)", [admin]);
  assert.equal(await scalar('select is_demo from organizations where id=$1', [demo]), true);
  await assert.rejects(db.query("select create_organization_with_mode_checked($1,'Unwanted','unwanted','club',true)", [manager]), /Forbidden/);
  assert.equal(await scalar("select count(*)::int from organizations where slug='unwanted'"), 0);
});

test('manager and authenticated direct requests cannot toggle demo or invoke privileged operations', async () => {
  await session('authenticated');
  await assert.rejects(db.query('update organizations set is_demo=false where id=$1', [demo]), /checked superadmin/);
  await assert.rejects(db.query("insert into organizations(name,slug,org_type,is_demo) values('Unwanted','direct-demo','club',true)"), /checked superadmin/);
  await assert.rejects(db.query("select create_organization_with_mode_checked($1,'Unwanted','unwanted','club',true)", [admin]), /permission denied/);
  await assert.rejects(db.query("select save_organization_settings_checked($1,$2,'{}','{}')", [admin, demo]), /permission denied/);
});

test('old settings clients preserve demo mode; a checked admin can change it with a strict boolean', async () => {
  await session('service_role');
  const values = { name: 'Demo club renamed', slug: 'demo-club', org_type: 'club', is_active: true };
  await db.query('select save_organization_settings_checked($1,$2,$3,$4)', [admin, demo, values, { description: 'Synthetic' }]);
  assert.equal(await scalar('select is_demo from organizations where id=$1', [demo]), true);
  await assert.rejects(db.query('select save_organization_settings_checked($1,$2,$3,$4)', [manager, demo, { ...values, is_demo: false }, {}]), /Forbidden/);
  await assert.rejects(db.query('select save_organization_settings_checked($1,$2,$3,$4)', [admin, demo, { ...values, is_demo: 'false' }, {}]), /Invalid settings/);
  await db.query('select save_organization_settings_checked($1,$2,$3,$4)', [admin, demo, { ...values, is_demo: false }, {}]);
  assert.equal(await scalar('select is_demo from organizations where id=$1', [demo]), false);
  await db.query('select save_organization_settings_checked($1,$2,$3,$4)', [admin, demo, { ...values, is_demo: true }, {}]);
});

test('reapplication preserves demo status and existing organization records', async () => {
  await db.exec('reset role');
  const before = (await db.query('select * from organizations order by id')).rows;
  await db.exec(organizationDemoBatch());
  assert.deepEqual((await db.query('select * from organizations order by id')).rows, before);
});

test('migration preservation assertion rejects unrelated row changes and rolls them back', async () => {
  const before = (await db.query('select * from profiles')).rows;
  const changed = organizationDemoBatch().replace("notify pgrst,'reload schema';", "update public.profiles set name='Unwanted'; notify pgrst,'reload schema';");
  await assert.rejects(db.exec(changed), /Existing records changed: public.profiles/);
  await db.exec('rollback');
  assert.deepEqual((await db.query('select * from profiles')).rows, before);
});
