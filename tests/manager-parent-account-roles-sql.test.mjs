// Local PostgreSQL integration tests; no connection to Supabase or real accounts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { before, beforeEach, after, test } from 'node:test';

const modulePath = process.env.MANAGER_PGLITE_MODULE;
const db = modulePath ? new (await import(pathToFileURL(modulePath).href)).PGlite() : null;
const sqlTest = (name, run) => test(name, { skip: !db && 'Set MANAGER_PGLITE_MODULE to run PostgreSQL tests.' }, run);
const migration = await readFile(new URL('../supabase/migrations/20261017_manager_parent_account_roles.sql', import.meta.url), 'utf8');
const postflight = await readFile(new URL('../supabase/checks/20261017_manager_parent_account_roles_postflight.sql', import.meta.url), 'utf8');
before(async () => { if (db) await db.exec('create role anon; create role authenticated; create role service_role;'); });
beforeEach(async () => {
  if (!db) return;
  await db.exec(`drop schema public cascade; create schema public;
    create table public.club_members (id int primary key, club_id int not null, user_id int not null,
      role text not null, is_active boolean not null, note text,
      constraint club_members_unique_club_user unique(club_id,user_id));
    create table public.season_records (id int primary key, member_id int references public.club_members(id), note text);
    alter table public.club_members enable row level security;
    create policy deny_direct_insert on public.club_members for insert to authenticated with check(false);
    grant insert on public.club_members to authenticated;
    insert into public.club_members values(1,10,100,'coach',true,'Preserve coach'),(2,10,200,'player',true,'Preserve junior');
    insert into public.season_records values(1,1,'Preserve season');
    create function public.manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean) returns void
      language sql as 'select';
    revoke all on function public.manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean) from public;
    grant execute on function public.manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean) to service_role;
  `);
});
after(() => db?.close());

sqlTest('parent role migration retains existing membership IDs, season links, RLS and privileges and is repeatable', async () => {
  const beforeRows = await db.query('select * from club_members order by id');
  const beforeRefs = await db.query('select * from season_records');
  await assert.rejects(() => db.exec("insert into club_members values(3,10,100,'parent',true,null)"), /club_members_unique_club_user/);
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query('select * from club_members order by id')).rows, beforeRows.rows);
  assert.deepEqual((await db.query('select * from season_records')).rows, beforeRefs.rows);
  await db.exec("insert into club_members values(3,10,100,'parent',true,null)");
  assert.deepEqual((await db.query('select role from club_members where user_id=100 order by role')).rows, [{ role: 'coach' }, { role: 'parent' }]);
  await assert.rejects(() => db.exec("insert into club_members values(4,10,100,'parent',true,null)"), /duplicate key/);
  const checks = (await db.query(postflight)).rows;
  assert.equal(checks.length, 8);
  for (const row of checks) assert.equal(row.ok, true, row.check_name);
  assert.equal((await db.query("select count(*)::int as n from pg_policy where polrelid='club_members'::regclass")).rows[0].n, 1);
  assert.equal((await db.query("select has_table_privilege('authenticated','public.club_members','INSERT') as allowed")).rows[0].allowed, true);
  assert.equal((await db.query("select has_table_privilege('anon','public.club_members','INSERT') as allowed")).rows[0].allowed, false);
});

sqlTest('legacy standalone indexes and existing role-level uniqueness are handled without duplicates', async () => {
  await db.exec(`alter table club_members drop constraint club_members_unique_club_user;
    create unique index club_members_unique_club_user on club_members(user_id,club_id);
    create unique index existing_role_index on club_members(club_id,user_id,role);`);
  await db.exec(migration);
  await db.exec("insert into club_members values(3,10,100,'parent',true,null)");
  const indexes = (await db.query("select indexname from pg_indexes where tablename='club_members' order by indexname")).rows;
  assert.deepEqual(indexes, [{ indexname: 'club_members_pkey' }, { indexname: 'existing_role_index' }]);
});

sqlTest('a foreign key depending on the legacy pair aborts the migration instead of deleting references', async () => {
  await db.exec('create table pair_reference (club_id int,user_id int,foreign key(club_id,user_id) references club_members(club_id,user_id)); insert into pair_reference values(10,100);');
  await assert.rejects(() => db.exec(migration), /depend/);
  await db.exec('rollback');
  assert.deepEqual((await db.query('select * from pair_reference')).rows, [{ club_id: 10, user_id: 100 }]);
  await assert.rejects(() => db.exec("insert into club_members values(3,10,100,'parent',true,null)"), /club_members_unique_club_user/);
  assert.equal((await db.query("select to_regclass('public.club_members_club_user_role_unique_idx') as name")).rows[0].name, null);
});
