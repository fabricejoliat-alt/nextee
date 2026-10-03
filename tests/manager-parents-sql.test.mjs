import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { before, beforeEach, after, test } from 'node:test';
const modulePath = process.env.MANAGER_PGLITE_MODULE;
const db = modulePath ? new (await import(pathToFileURL(modulePath).href)).PGlite() : null;
const sqlTest = (name, run) => test(name, { skip: !db && 'Set MANAGER_PGLITE_MODULE.' }, run);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manager=id(1), parent=id(2), local=id(3), shared=id(4), foreign=id(5), A=id(10), B=id(11), member=id(20);
const remove = (players=[local,shared], sharedPlayers=[shared], actor=manager, club=A, target=member) => db.query(
  'select remove_manager_parent_v1($1,$2,$3,$4::uuid[],$5::uuid[]) as result', [actor,club,target,players,sharedPlayers]);
before(async()=>{
  if(!db)return;
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key);
    create table app_admins(user_id uuid primary key);
    create table club_members(id uuid primary key default gen_random_uuid(),club_id uuid,user_id uuid references profiles(id),role text,is_active boolean,unique(club_id,user_id,role));
    create table player_guardians(player_id uuid references profiles(id),guardian_user_id uuid references profiles(id),can_view boolean,can_edit boolean,is_primary boolean,primary key(player_id,guardian_user_id));
    create table player_periodic_report_configs(club_id uuid,player_user_id uuid,recipient_user_ids uuid[],updated_at timestamptz);
    create table access_invitation_tokens(id uuid primary key default gen_random_uuid(),club_id uuid,user_id uuid,recipient_user_id uuid,invitation_kind text,consumed_at timestamptz);
  `);
  const migration=await readFile(new URL('../supabase/migrations/20261018_manager_parent_directory.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
});
beforeEach(async()=>{
  if(!db)return;
  await db.exec(`truncate player_guardians,player_periodic_report_configs,access_invitation_tokens,club_members,app_admins,profiles cascade;
    insert into profiles values('${manager}'),('${parent}'),('${local}'),('${shared}'),('${foreign}');
    insert into club_members(club_id,user_id,role,is_active) values
      ('${A}','${manager}','manager',true),('${A}','${parent}','coach',true),('${B}','${parent}','parent',true),
      ('${A}','${local}','player',true),('${A}','${shared}','player',true),('${B}','${shared}','player',false),('${B}','${foreign}','player',true);
    insert into club_members values('${member}','${A}','${parent}','parent',true);
    insert into player_guardians values('${local}','${parent}',true,true,true),('${shared}','${parent}',true,true,true),('${foreign}','${parent}',true,true,true);
    insert into player_periodic_report_configs values
      ('${A}','${local}',array['${parent}'::uuid],now()),('${A}','${shared}',array['${parent}'::uuid],now()),('${B}','${shared}',array['${parent}'::uuid],now());
    insert into access_invitation_tokens(club_id,user_id,recipient_user_id,invitation_kind) values
      ('${A}','${parent}','${parent}','parent_access'),('${A}','${local}','${parent}','junior_access'),
      ('${B}','${parent}','${parent}','parent_access'),('${A}','${parent}','${parent}','account_recovery');
  `);
});
after(()=>db?.close());
sqlTest('removing a club parent revokes local links and invitations but retains shared families, other roles, profiles and recovery',async()=>{
  await db.exec('set role service_role');let result;try{result=await remove();}finally{await db.exec('reset role');}
  assert.deepEqual(result.rows[0].result,{ok:true,removed_links:1,preserved_shared_links:1});
  assert.equal((await db.query('select count(*)::int as n from profiles')).rows[0].n,5);
  assert.equal((await db.query('select count(*)::int as n from club_members where user_id=$1',[parent])).rows[0].n,2);
  assert.deepEqual((await db.query('select player_id from player_guardians order by player_id')).rows,[{player_id:shared},{player_id:foreign}]);
  assert.ok((await db.query('select recipient_user_ids from player_periodic_report_configs where club_id=$1',[A])).rows.every(row=>!row.recipient_user_ids.length));
  assert.deepEqual((await db.query('select recipient_user_ids from player_periodic_report_configs where club_id=$1',[B])).rows[0].recipient_user_ids,[parent]);
  assert.equal((await db.query('select count(*)::int as n from access_invitation_tokens where consumed_at is not null')).rows[0].n,2);
  assert.equal((await db.query("select consumed_at from access_invitation_tokens where invitation_kind='account_recovery'")).rows[0].consumed_at,null);
});
sqlTest('parent removal rejects foreign scope, wrong role, inactive actors and protected accounts without mutations',async()=>{
  await assert.rejects(()=>remove([local,shared],[shared],manager,B),/manager_forbidden/);
  const coachMember=(await db.query("select id from club_members where user_id=$1 and role='coach'",[parent])).rows[0].id;
  await assert.rejects(()=>remove([],[],manager,A,coachMember),/parent_not_found/);
  await db.query('insert into app_admins values($1)',[parent]);
  await assert.rejects(()=>remove(),/protected_account/);
  await db.query('update club_members set is_active=false where user_id=$1',[manager]);
  await assert.rejects(()=>remove(),/manager_forbidden/);
  assert.equal((await db.query('select count(*)::int as n from player_guardians')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int as n from access_invitation_tokens where consumed_at is not null')).rows[0].n,0);
});
sqlTest('stale confirmation refuses changed family links and preserves the parent',async()=>{
  for(const [players,sharedPlayers]of [[[],[]],[[local,shared],[]],[[local,shared,foreign],[shared]]])await assert.rejects(()=>remove(players,sharedPlayers),/parent_links_changed/);
  assert.equal((await db.query('select count(*)::int as n from club_members where id=$1',[member])).rows[0].n,1);
});
sqlTest('an unlinked parent can be removed and a database failure rolls back every dependent change',async()=>{
  await db.exec("create function fail_delete() returns trigger language plpgsql as $$begin raise exception 'qa_failure';end;$$;create trigger fail_delete before delete on club_members for each row execute function fail_delete();");
  try{await assert.rejects(()=>remove(),/qa_failure/);}finally{await db.exec('drop trigger fail_delete on club_members');}
  assert.equal((await db.query('select count(*)::int as n from player_guardians')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int as n from access_invitation_tokens where consumed_at is not null')).rows[0].n,0);
  await db.query('delete from player_guardians where guardian_user_id=$1',[parent]);
  assert.equal((await remove([],[])).rows[0].result.removed_links,0);
});
sqlTest('parent removal cannot be executed directly by a browser and all six postflight checks pass',async()=>{
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);try{await assert.rejects(()=>remove(),/permission denied/);}finally{await db.exec('reset role');}
  }
  const checks=(await db.query(await readFile(new URL('../supabase/checks/20261018_manager_parent_directory_postflight.sql',import.meta.url),'utf8'))).rows;
  assert.equal(checks.length,6);for(const row of checks)assert.equal(row.ok,true,row.check_name);
});
