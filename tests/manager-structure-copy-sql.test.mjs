// Isolated PostgreSQL; this never connects to Supabase or uses real club records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const runtime=process.env.MANAGER_PGLITE_MODULE;
const sql=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('atomic Manager structure copy in isolated PostgreSQL',{skip:!runtime&&'Set MANAGER_PGLITE_MODULE'},async t=>{
  const {PGlite}=await import(pathToFileURL(runtime).href);const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    create table app_admins(user_id uuid);
    create table club_members(club_id uuid,user_id uuid,role text,is_active boolean);
    create table club_event_series(id uuid primary key,club_id uuid,group_id uuid);
    create table club_events(id uuid primary key,group_id uuid,club_id uuid,series_id uuid,status text,event_type text,title text,
      starts_at timestamptz,ends_at timestamptz,duration_minutes int,location_text text,coach_note text,requires_evaluation boolean);
    create table club_event_coaches(event_id uuid,coach_id uuid);
    create table club_event_attendees(event_id uuid,player_id uuid,status text,coach_recorded_status text);
    create table club_event_structure_items(id uuid primary key default gen_random_uuid(),event_id uuid,category text,minutes int check(minutes>0),note text,position int);
    create table club_event_evaluation_criteria(id uuid,event_id uuid,criterion_id uuid,position int,is_enabled boolean);
    create table club_camp_days(event_id uuid,camp_id uuid,day_index int,starts_at timestamptz,ends_at timestamptz,location_text text);
    insert into club_members values('${id(1)}','${id(2)}','manager',true),('${id(1)}','${id(3)}','coach',true);
    insert into club_event_series values('${id(10)}','${id(1)}','${id(4)}');
    insert into club_events(id,club_id,group_id,series_id,status,event_type,starts_at,title) values
      ('${id(20)}','${id(1)}','${id(4)}','${id(10)}','scheduled','training','2020-01-01','Source'),
      ('${id(21)}','${id(1)}','${id(4)}','${id(10)}','scheduled','training','2021-01-01','Past'),
      ('${id(22)}','${id(1)}','${id(4)}','${id(10)}','scheduled','training','2099-01-01','Future'),
      ('${id(23)}','${id(1)}','${id(4)}','${id(10)}','scheduled','training','2099-02-01','Future two'),
      ('${id(24)}','${id(1)}','${id(4)}','${id(10)}','cancelled','training','2099-03-01','Cancelled');
    insert into club_event_structure_items(event_id,category,minutes,note,position) values
      ('${id(20)}','putting',30,'Texte du club {name}',1),('${id(20)}','course',30,null,2),
      ('${id(21)}','other',15,'Past preserved',1),('${id(22)}','other',15,'Future original',1),
      ('${id(23)}','other',15,'Second original',1),('${id(24)}','other',15,'Cancelled preserved',1);
    insert into club_event_attendees values('${id(22)}','${id(30)}','absent','present');
    insert into club_event_coaches values('${id(22)}','${id(3)}');
    select set_config('request.jwt.claim.sub','${id(2)}',false);`);
  const prior=sql('20261009_manager_reliability_batch2.sql');
  for(const name of ['require_manager_club_scope_v1','manager_event_snapshot_v1','get_manager_planning_snapshot_v1']){
    const definition=prior.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));assert.ok(definition,name);await db.exec(definition[0]);
  }
  const migration=sql('20261012_manager_structure_copy.sql');await db.exec(migration);await db.exec(migration);
  const query=async(q,p=[]) => (await db.query(q,p)).rows;
  const snapshot=async()=> (await query('select get_manager_planning_snapshot_v1($1) data',[id(20)]))[0].data;
  const state=async()=>query('select * from club_event_structure_items order by event_id,position,id');
  const copy=async(expected)=> (await query('select copy_manager_event_structure_v1($1,$2) data',[id(20),JSON.stringify(expected)]))[0].data;
  const checks=(await db.query(readFileSync(new URL('../supabase/checks/20261012_manager_structure_copy_postflight.sql',import.meta.url),'utf8'))).rows;
  assert.equal(checks.length,9);assert.ok(checks.every(c=>c.status==='ok'),JSON.stringify(checks));
  await t.test('anonymous and foreign/coach accounts cannot copy',async()=>{
    const expected=await snapshot(),before=await state();
    await db.exec('set role anon');await assert.rejects(copy(expected),/permission denied/);await db.exec('reset role');
    for(const actor of [id(3),id(90)]){await query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await assert.rejects(copy(expected),/forbidden/);}
    await query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);assert.deepEqual(await state(),before);
  });
  await t.test('stale source or future snapshot aborts without changing any structure',async()=>{
    const expected=await snapshot();await query('update club_event_structure_items set note=$1 where event_id=$2',['Changed',id(22)]);const before=await state();
    await assert.rejects(copy(expected),/planning_conflict/);assert.deepEqual(await state(),before);
    const next=await snapshot();await query('update club_event_structure_items set note=$1 where event_id=$2',['Source changed',id(20)]);const changed=await state();
    await assert.rejects(copy(next),/planning_conflict/);assert.deepEqual(await state(),changed);
  });
  await t.test('an insertion error on a later event rolls back all replacements',async()=>{
    await db.exec(`create function fail_second_copy() returns trigger language plpgsql as $$ begin if new.event_id='${id(23)}' then raise exception 'forced_insert_failure'; end if; return new; end $$;
      create trigger fail_second before insert on club_event_structure_items for each row execute function fail_second_copy();`);
    const before=await state();await assert.rejects(copy(await snapshot()),/forced_insert_failure/);assert.deepEqual(await state(),before);
    await db.exec('drop trigger fail_second on club_event_structure_items');
  });
  await t.test('cross-club targets are rejected even with a matching snapshot',async()=>{
    await query('update club_events set club_id=$1 where id=$2',[id(99),id(23)]);const before=await state();await assert.rejects(copy(await snapshot()),/forbidden/);assert.deepEqual(await state(),before);
    await query('update club_events set club_id=$1 where id=$2',[id(1),id(23)]);
  });
  await t.test('only scheduled future structures change; source, history, roster and attendance survive',async()=>{
    const before=await state(),attendees=await query('select * from club_event_attendees'),coaches=await query('select * from club_event_coaches'),expected=await snapshot();
    await db.exec('set role authenticated');assert.deepEqual(await copy(expected),{copied:2});await db.exec('reset role');
    const after=await state();for(const event of [id(20),id(21),id(24)])assert.deepEqual(after.filter(x=>x.event_id===event),before.filter(x=>x.event_id===event));
    for(const event of [id(22),id(23)])assert.deepEqual(after.filter(x=>x.event_id===event).map(({category,minutes,note,position})=>({category,minutes,note,position})),before.filter(x=>x.event_id===id(20)).map(({category,minutes,note,position})=>({category,minutes,note,position})));
    assert.deepEqual(await query('select * from club_event_attendees'),attendees);assert.deepEqual(await query('select * from club_event_coaches'),coaches);
  });
});
