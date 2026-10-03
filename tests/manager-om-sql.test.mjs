// Real isolated PostgreSQL: no network, credentials or real club records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const runtime=process.env.MANAGER_PGLITE_MODULE;
const read=file=>readFileSync(new URL(`../supabase/${file}`,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Manager OM transactional writes in PostgreSQL',{skip:!runtime&&'Set MANAGER_PGLITE_MODULE'},async t=>{
 const {PGlite}=await import(pathToFileURL(runtime).href),db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 create table organizations(id uuid primary key);create table profiles(id uuid primary key,first_name text,last_name text);
 create table app_admins(user_id uuid);create table club_members(club_id uuid,user_id uuid,role text,is_active boolean);
 create table coach_groups(id uuid primary key,club_id uuid,name text,is_active boolean,club_season_id uuid);
 create table coach_group_players(group_id uuid,player_user_id uuid);
 create table club_events(id uuid primary key);
 create function om_publish_internal_contest(uuid,jsonb,jsonb) returns void language sql as $$select$$;`);
 const core=read('migrations/20260305_add_ordre_du_merite_core.sql');
 for(const name of ['om_exceptional_tournaments','om_bonus_entries','om_internal_contests','om_internal_contest_results']){
  const ddl=core.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`));assert.ok(ddl,name);await db.exec(ddl[0]);
 }
 await db.exec(`create table golf_rounds(id uuid primary key,om_exceptional_tournament_id uuid references om_exceptional_tournaments(id) on delete set null,score int,start_at timestamptz,competition_name text,course_name text);
 alter table profiles add column avatar_url text;
 create table om_tournament_scores(round_id uuid,organization_id uuid,player_id uuid,occurred_on date,competition_level text,competition_format text,rounds_18_count int,total_points_net numeric,total_points_brut numeric,calculated_at timestamptz);
 create table player_guardians(player_id uuid,guardian_user_id uuid,can_view boolean);
 alter table club_members add column is_performance boolean default true;
 create function is_org_staff_member(uuid,uuid) returns boolean language sql as $$select false$$;
 grant all on all tables in schema public to authenticated;
 alter table om_bonus_entries enable row level security;create policy fixture_manager on om_bonus_entries for all to authenticated using(true) with check(true);
 insert into organizations values('${id(1)}'),('${id(9)}');
 insert into profiles(id,first_name,last_name) values('${id(2)}','Manager','A'),('${id(3)}','Coach','A'),('${id(4)}','Player','A'),('${id(5)}','Player','B'),('${id(6)}','Player','Foreign'),('${id(7)}','Player','Inactive');
 insert into club_members(club_id,user_id,role,is_active) values('${id(1)}','${id(2)}','manager',true),('${id(1)}','${id(3)}','coach',true),('${id(1)}','${id(4)}','player',true),('${id(1)}','${id(5)}','player',true),('${id(9)}','${id(6)}','player',true),('${id(1)}','${id(7)}','player',false);
 insert into coach_groups values('${id(10)}','${id(1)}','Juniors',true,'${id(50)}'),('${id(11)}','${id(9)}','Foreign',true,'${id(50)}');
 insert into coach_group_players values('${id(10)}','${id(4)}');
 select set_config('request.jwt.claim.sub','${id(2)}',false);`);
 for(const name of ['om_period_slot','om_period_limit']){
  const definition=core.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));assert.ok(definition,name);await db.exec(definition[0]);
 }
 const rankingDefinition=read('migrations/20260412_multi_club_om_tournament_scores.sql').match(/create or replace function public\.om_ranking_snapshot\([\s\S]*?\$\$;/);await db.exec(rankingDefinition[0]);
 const prior=read('migrations/20261009_manager_reliability_batch2.sql').match(/create or replace function public\.require_manager_club_scope_v1\([\s\S]*?\$\$;/);await db.exec(prior[0]);
 const migration=read('migrations/20261016_manager_order_of_merit.sql');await db.exec(migration);await db.exec(migration);
 const query=async(q,p=[]) =>(await db.query(q,p)).rows;
 const rpc=async(q,p)=>(await query(q,p))[0].data;
 const data=async(kind='contest')=>rpc('select get_manager_om_data_v1($1,$2) data',[id(1),kind]);
 const snapshot=async(contest)=>rpc('select get_manager_om_contest_v1($1) data',[contest]);
 let req=100;
 const write=async(kind,action,record=null,payload={},expected=null,request=id(req++),club=id(1))=>rpc('select write_manager_om_v1($1,$2,$3,$4,$5,$6,$7) data',[request,club,kind,action,record,expected,JSON.stringify(payload)]);
 const create=async(payload={})=>(await write('contest','create',null,{name:'Contest',date:'2026-10-03',...payload})).id;
 const publish=async(c,rankings,extra={},expected)=>write('contest','publish',c,{rankings,...extra},expected??(await snapshot(c)).version);
 const state=async()=>({contests:await query('select * from om_internal_contests order by id'),results:await query('select * from om_internal_contest_results order by contest_id,player_id'),bonuses:await query('select * from om_bonus_entries order by id'),requests:await query('select * from manager_om_write_requests order by request_id')});
 const rankings=[{player_id:id(4),rank:1,note:'Original {note}'},{player_id:id(5),rank:2}];
 let contest;
 await t.test('migration is repeatable and all 17 postflight checks pass',async()=>{const checks=await query(read('checks/20261016_manager_order_of_merit_postflight.sql'));assert.equal(checks.length,17);assert.ok(checks.every(c=>c.status==='ok'),JSON.stringify(checks));});
 await t.test('anonymous, inactive and coach users cannot access Manager data or writes',async()=>{
  await db.exec('set role anon');await assert.rejects(data(),/permission denied/);await assert.rejects(create(),/permission denied/);await db.exec('reset role');
  for(const actor of [id(3),id(7),id(98)]){await query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await assert.rejects(data(),/forbidden/);await assert.rejects(create(),/forbidden/);}
  await query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);
  await assert.rejects(write('contest','create',null,{name:'No',date:'2026-01-01'},null,undefined,id(9)),/forbidden/);
 });
 await t.test('create is retry-safe and validates group scope and dates',async()=>{
  await assert.rejects(create({group_id:id(11)}),/invalid_group/);await assert.rejects(create({date:''}),/date/);
  await assert.rejects(write('tournament','create',null,{name:'Bad',starts_on:'2026-10-03',ends_on:'2026-10-01'}),/invalid_dates/);
  const request=id(req++),payload={name:'Repeat safe',date:'2026-10-03'};
  const first=await write('contest','create',null,payload,null,request),again=await write('contest','create',null,payload,null,request);
  assert.equal(first.id,again.id);assert.equal(again.replayed,true);assert.equal((await data()).rows.length,1);
  await assert.rejects(write('contest','create',null,{...payload,name:'Changed'},null,request),/request_conflict/);contest=first.id;
 });
 await t.test('invalid, duplicate and foreign players fail without any partial writes',async()=>{
  const before=await state();for(const r of [[{player_id:id(6),rank:1}],[{player_id:id(7),rank:1}],[{player_id:id(3),rank:1}]])await assert.rejects(publish(contest,r),/invalid_player/);
  await assert.rejects(publish(contest,[rankings[0],rankings[0]]),/duplicate_player/);
  for(const rank of [0,-1,1.5,10001,'x'])await assert.rejects(publish(contest,[{player_id:id(4),rank}]),/invalid_rankings/);
  assert.deepEqual(await state(),before);
  const grouped=await create({group_id:id(10)});await assert.rejects(publish(grouped,[rankings[1]]),/invalid_player/);
  assert.deepEqual((await snapshot(grouped)).players.map(p=>p.id),[id(4)]);
 });
 await t.test('publishing assigns correct points, server names, retains IDs and permits tied ranks',async()=>{
  await db.exec('set role authenticated');await publish(contest,rankings);await db.exec('reset role');
  const before=await state(),oldResults=before.results,oldBonuses=before.bonuses;
  await publish(contest,[{...rankings[0],rank:2},{...rankings[1],rank:2}]);
  const after=await state();assert.deepEqual(after.results.map(r=>r.created_at),oldResults.map(r=>r.created_at));assert.deepEqual(after.bonuses.map(b=>b.id),oldBonuses.map(b=>b.id));assert.ok(after.bonuses.every(b=>Number(b.points_net)===10&&Number(b.points_brut)===10));
  const snap=await snapshot(contest);assert.equal(snap.contest.full_ranking[0].player_name,'Player A');assert.equal(snap.results[0].note,'Original {note}');
 });
 await t.test('old snapshots cannot overwrite a newer publication',async()=>{
  const old=await snapshot(contest);await publish(contest,rankings);const before=await state();await assert.rejects(publish(contest,[],{allow_empty:true},old.version),/om_conflict/);assert.deepEqual(await state(),before);
 });
 await t.test('a late bonus failure rolls back results, bonuses, full ranking and retry ledger',async()=>{
  await db.exec(`create function fail_bonus() returns trigger language plpgsql as $$begin if new.player_id='${id(5)}' then raise exception 'forced_bonus_failure';end if;return new;end$$;create trigger fail_bonus before update on om_bonus_entries for each row execute function fail_bonus();`);
  const before=await state();await assert.rejects(publish(contest,[{...rankings[0],rank:3},{...rankings[1],rank:1}]),/forced_bonus_failure/);assert.deepEqual(await state(),before);await db.exec('drop trigger fail_bonus on om_bonus_entries');
 });
 await t.test('historical participants remain readable and retain results after membership changes',async()=>{
  await query('update club_members set is_active=false where user_id=$1',[id(4)]);assert.ok((await snapshot(contest)).players.some(p=>p.id===id(4)));await publish(contest,rankings);assert.equal((await snapshot(contest)).results.length,2);
  await query('update club_members set is_active=true where user_id=$1',[id(4)]);
 });
 await t.test('empty ranking requires explicit confirmation; obsolete bonuses are removed',async()=>{
  const c=await create();await publish(c,rankings);await assert.rejects(publish(c,[]),/empty_confirmation_required/);assert.equal((await snapshot(c)).results.length,2);
  await publish(c,[],{allow_empty:true});assert.equal((await snapshot(c)).results.length,0);assert.equal((await query('select * from om_bonus_entries where source_id=$1',[c])).length,0);
 });
 await t.test('delete failure preserves all data; successful delete removes results and podium bonuses',async()=>{
  await db.exec(`create function fail_delete() returns trigger language plpgsql as $$begin raise exception 'forced_delete_failure';end$$;create trigger fail_delete before delete on om_internal_contests for each row execute function fail_delete();`);
  const before=await state(),v=(await snapshot(contest)).version;await assert.rejects(write('contest','delete',contest,{},v),/forced_delete_failure/);assert.deepEqual(await state(),before);await db.exec('drop trigger fail_delete on om_internal_contests');
  await write('contest','delete',contest,{},v);assert.equal((await query('select * from om_bonus_entries where source_id=$1',[contest])).length,0);assert.equal((await query('select * from om_internal_contest_results where contest_id=$1',[contest])).length,0);
 });
 await t.test('referenced tournaments cannot be deleted and deactivation preserves all round fields',async()=>{
  const tour=(await write('tournament','create',null,{name:'Played tournament'})).id;let row=(await data('tournament')).rows.find(r=>r.id===tour);
  await query('insert into golf_rounds(id,om_exceptional_tournament_id,score) values($1,$2,72)',[id(99),tour]);const rounds=await query('select * from golf_rounds');
  await assert.rejects(write('tournament','delete',tour,{},row.version),/tournament_in_use/);
  await write('tournament','toggle',tour,{is_active:false},row.version);await assert.rejects(write('tournament','toggle',tour,{is_active:true},row.version),/om_conflict/);assert.deepEqual(await query('select * from golf_rounds'),rounds);
  row=(await data('tournament')).rows.find(r=>r.id===tour);assert.equal(row.is_active,false);
 });
 await t.test('ranking reads keep club scope, date scope and every detail beyond the REST row cap',async()=>{
  await db.exec('set role anon');await assert.rejects(query('select get_manager_om_ranking_v1($1,$2,$3,$4)',[id(1),'2026-01-01','2026-12-31',id(4)]),/permission denied/);await db.exec('reset role');
  await assert.rejects(query('select get_manager_om_ranking_v1($1,$2,$3,$4)',[id(9),'2026-01-01','2026-12-31',id(4)]),/forbidden/);
  await assert.rejects(query('select get_manager_om_ranking_v1($1,$2,$3,$4)',[id(1),'2026-12-31','2026-01-01',id(4)]),/invalid_dates/);
  await query("insert into om_bonus_entries(organization_id,player_id,bonus_type,points_net,occurred_on) select $1,$2,'manual_adjustment',1,'2026-08-01'::date from generate_series(1,1005)",[id(1),id(4)]);
  await query("insert into om_bonus_entries(organization_id,player_id,bonus_type,points_net,occurred_on) values($1,$2,'manual_adjustment',999,'2026-08-01'),($3,$2,'manual_adjustment',999,'2025-08-01')",[id(9),id(4),id(1)]);
  await db.exec('set role authenticated');const detail=await rpc('select get_manager_om_ranking_v1($1,$2,$3,$4) data',[id(1),'2026-08-01','2026-08-31',id(4)]);await db.exec('reset role');assert.equal(detail.bonuses.length,1005);assert.ok(detail.bonuses.every(b=>Number(b.points_net)===1));
  const ranking=await rpc('select get_manager_om_ranking_v1($1,$2,$3,null) data',[id(1),'2026-08-01','2026-08-31']);assert.equal(ranking.club_id,id(1));assert.equal(ranking.rows.length,1);assert.equal(Number(ranking.rows[0].bonus_points_net),1005);assert.equal(ranking.avatars[0].id,id(4));
  await query("delete from om_bonus_entries where bonus_type='manual_adjustment'");
 });
 await t.test('authenticated clients cannot bypass validated writes or forge podium points',async()=>{
  const c=await create();await publish(c,rankings);await db.exec('set role authenticated');
  await assert.rejects(query('delete from om_internal_contests where id=$1',[c]),/permission denied/);
  await assert.rejects(query('select om_publish_internal_contest($1,$2,$3)',[c,'[]','[]']),/permission denied/);
  await assert.rejects(query("insert into om_bonus_entries(organization_id,player_id,bonus_type,points_net,points_brut,occurred_on) values($1,$2,'internal_contest_podium',999,999,'2026-10-03')",[id(1),id(4)]),/row-level security/);
  const updated=await query("update om_bonus_entries set points_net=999 where bonus_type='internal_contest_podium' returning id");assert.equal(updated.length,0);
  await db.exec('reset role');assert.ok((await query('select * from om_bonus_entries')).every(b=>Number(b.points_net)<999));
 });
});
