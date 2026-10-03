import { runManagerGlobalActivityWrites } from "./helpers/manager-global-activity-writes-sql.mjs";
import { runManagerParticipantEvaluation } from "./helpers/manager-participant-evaluation-sql.mjs";
import { runManagerEventWrites } from "./helpers/manager-event-writes-sql.mjs";
// In-memory PostgreSQL only. Never contacts a project database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const runtime = process.env.MANAGER_PGLITE_MODULE;
const sql = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const club=id(1), foreignClub=id(2), manager=id(3), player=id(4), coach=id(5), outsider=id(6), group=id(7), extra=id(8), criterion=id(9);

test('Manager planning, seasons and camps in isolated PostgreSQL', {skip: !runtime && 'Set MANAGER_PGLITE_MODULE'}, async t => {
  const { PGlite } = await import(pathToFileURL(runtime).href);
  const db = new PGlite(); t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,service_role,anon;
    create table clubs(id uuid primary key);
    create table profiles(id uuid primary key);
    create table app_admins(user_id uuid primary key);
    create table club_members(id uuid primary key default gen_random_uuid(),club_id uuid references clubs,user_id uuid references profiles,role text,is_active boolean,
      can_manage_assigned_groups boolean default true,can_manage_assigned_group_planning boolean default true);
    create table coach_groups(id uuid primary key default gen_random_uuid(),club_id uuid references clubs,name text,is_active boolean default true,
      head_coach_user_id uuid,is_performance boolean default false);
    create table coach_group_players(group_id uuid references coach_groups,player_user_id uuid,primary key(group_id,player_user_id));
    create table coach_group_coaches(group_id uuid references coach_groups,coach_user_id uuid,is_head boolean,primary key(group_id,coach_user_id));
    create table coach_group_categories(group_id uuid references coach_groups,category text);
    create table club_events(id uuid primary key default gen_random_uuid(),group_id uuid references coach_groups,club_id uuid references clubs,
      event_type text default 'training',status text default 'scheduled',title text,starts_at timestamptz,ends_at timestamptz,duration_minutes int,
      location_text text,coach_note text,series_id uuid,created_by uuid,requires_evaluation boolean default false);
    create table club_event_series(id uuid primary key default gen_random_uuid(),group_id uuid,club_id uuid,event_type text,title text,
      location_text text,coach_note text,weekday int,time_of_day time,interval_weeks int,start_date date,end_date date,duration_minutes int,is_active boolean,created_by uuid);
    create table club_event_coaches(event_id uuid references club_events,coach_id uuid,primary key(event_id,coach_id));
    create table club_event_attendees(event_id uuid references club_events,player_id uuid,status text,coach_recorded_status text,coach_recorded_by uuid,
      coach_recorded_at timestamptz,created_at timestamptz default now(),primary key(event_id,player_id));
    create table club_event_structure_items(id uuid primary key default gen_random_uuid(),event_id uuid references club_events,category text,minutes int,note text,position int);
    create table club_event_player_structure_items(event_id uuid references club_events,player_id uuid,note text);
    create table club_event_coach_feedback(event_id uuid references club_events,player_id uuid,coach_id uuid,private_note text);
    create table club_event_player_feedback(event_id uuid references club_events,player_id uuid,note text);
    create table coach_player_private_notes(event_id uuid references club_events,player_id uuid,body text);
    create table message_threads(event_id uuid references club_events,body text);
    create table training_sessions(club_event_id uuid references club_events);
    create table club_player_fields(id uuid primary key);
    create function is_org_manager_member(uuid,uuid) returns boolean language sql as $$ select exists(select 1 from club_members where club_id=$1 and user_id=$2 and role='manager' and is_active) $$;
    create function is_group_staff_member(uuid,uuid) returns boolean language sql as $$ select false $$;
    insert into clubs values('${club}'),('${foreignClub}');
    insert into profiles values('${manager}'),('${player}'),('${coach}'),('${outsider}'),('${extra}');
    insert into auth.users select id from profiles;
    insert into club_members(club_id,user_id,role,is_active) values('${club}','${manager}','manager',true),('${club}','${manager}','parent',true),
      ('${club}','${player}','player',true),('${club}','${extra}','player',true),('${club}','${coach}','coach',true),('${foreignClub}','${outsider}','player',true);
    insert into coach_groups(id,club_id,name) values('${group}','${club}','Juniors');
    select set_config('request.jwt.claim.sub','${manager}',false);
  `);
  const season = sql('20260830_player_seasons_and_fields.sql');
  await db.exec(season.slice(season.indexOf('create table if not exists public.club_seasons'),season.indexOf('-- Sensitive values')));
  const coachSeason = sql('20260901_coach_seasons_and_fields.sql');
  await db.exec(coachSeason.slice(0,coachSeason.indexOf('alter table')));
  await db.exec(sql('20260902_seasonal_groups.sql'));
  await db.exec(sql('20260323_add_club_camps.sql'));
  await db.exec(`alter table club_camps add column image_url text;
    alter table club_camp_days add column starts_at timestamptz,add column ends_at timestamptz,add column location_text text;`);
  await db.exec(sql('20260906_camps_management.sql').split('alter table public.club_camp_options enable row level security')[0]);
  await db.exec(sql('20260925_add_camp_option_types.sql'));
  await db.exec(sql('20260323_adjust_camp_attendee_default_status.sql'));
  await db.exec(sql('20260910_add_custom_evaluation_criteria.sql'));
  await db.exec(sql('20260912_add_coach_club_permissions_and_player_transfers.sql').match(/create or replace function public\.can_manage_assigned_group\([\s\S]*?\$\$;/)[0]);
  await db.exec(sql('20261004_coach_occurrence_save.sql'));
  for(const file of ['20261009_manager_reliability_batch2.sql','20261010_manager_camp_save.sql']) { await db.exec(sql(file)); await db.exec(sql(file)); }
  const postflight = readFileSync(new URL('../supabase/checks/20261009_manager_reliability_postflight.sql', import.meta.url),'utf8');
  const checks = (await db.query(postflight)).rows;
  assert.equal(checks.length,14);
  assert.ok(checks.every(check => check.ok), JSON.stringify(checks.filter(check => !check.ok)));
  await db.exec(`insert into club_evaluation_criteria(id,club_id,name,respondent,response_format,choices_json,activity_types,domain_key,domain_label)
    values('${criterion}','${club}','Test','both','yes_no','[{"value":true},{"value":false}]',array['training','camp'],'mental','Mental');`);
  const query = async (q,p=[]) => (await db.query(q,p)).rows;
  const snapshot = async event => (await query('select get_manager_planning_snapshot_v1($1) data',[event]))[0].data;
  const state = async () => (await query(`select jsonb_build_object(
    'events',(select jsonb_agg(x order by id) from club_events x),'attendees',(select jsonb_agg(x order by event_id,player_id) from club_event_attendees x),
    'camps',(select jsonb_agg(x order by id) from club_camps x),'days',(select jsonb_agg(x order by id) from club_camp_days x),
    'registrations',(select jsonb_agg(x order by camp_id,player_id) from club_camp_players x),'options',(select jsonb_agg(x order by id) from club_camp_options x),
    'assignments',(select jsonb_agg(x order by option_id,player_id) from club_camp_player_options x),
    'series',(select jsonb_agg(x order by id) from club_event_series x),'seasons',(select jsonb_agg(x order by id) from club_seasons x),
    'season_records',(select jsonb_agg(x order by id) from club_player_season_records x),
    'season_values',(select jsonb_agg(x order by club_player_season_record_id,field_id) from club_player_season_field_values x),
    'groups',(select jsonb_agg(x order by id) from coach_groups x)) data`))[0].data;
  const makeEvent = async (series=null,when='2090-01-02T10:00:00Z') => {
    const event=(await query(`insert into club_events(club_id,group_id,series_id,title,starts_at,ends_at,duration_minutes,requires_evaluation)
      values($1,$2,$3,'Weekly',$4::timestamptz,$4::timestamptz+interval '1 hour',60,true) returning id`,[club,group,series,when]))[0].id;
    await query("insert into club_event_attendees(event_id,player_id,status) values($1,$2,'absent')",[event,player]);
    await query('insert into club_event_coaches values($1,$2)',[event,coach]);
    return event;
  };
  const saveOccurrence = (event,expected,changes={},players=[player],criteria=[]) => query('select update_manager_event_occurrence_v1($1,$2,$3,$4::uuid[],$5::uuid[],$6,$7::uuid[]) data',
    [event,JSON.stringify(expected),JSON.stringify({...expected.event,title:'Updated',...changes}),[coach],players,'[]',criteria]);
  const campVersion = async camp => (await query('select manager_camp_version_v1($1) version',[camp]))[0].version;
  const saveCamp = (camp,version,body,actor=manager) => query('select save_manager_camp_v1($1,$2,$3,$4,$5) data',[actor,camp,club,version,JSON.stringify(body)]);
  const campBody = () => ({title:'Camp',status:'scheduled',head_coach_user_id:coach,group_ids:[group],player_ids:[player],coach_ids:[coach],options:[],
    player_registrations:[{player_id:player,registration_status:'registered',day_status_by_day_index:{0:'absent',1:'present'}}],
    days:[0,1].map(i=>({starts_at:`2090-02-0${i+1}T09:00Z`,ends_at:`2090-02-0${i+1}T10:00Z`,coach_ids:[],evaluation_enabled:true,evaluation_criterion_ids:[criterion]}))});
  const makeCamp = async () => {const body=campBody(),saved=(await saveCamp(null,null,body))[0].data; body.days.forEach((d,i)=>d.event_id=saved.days[i].event_id); return {body,camp:saved.camp_id};};

  await t.test('occurrence preserves RSVP, recorded attendance, criteria answers and discussion',async()=>{
    const event=await makeEvent();
    await query("update club_event_attendees set coach_recorded_status='absent',coach_recorded_by=$2,coach_recorded_at=now() where event_id=$1",[event,coach]);
    await query("insert into message_threads values($1,'Keep discussion')",[event]);
    const link=(await query('insert into club_event_evaluation_criteria(club_id,event_id,criterion_id,position) values($1,$2,$3,1) returning id',[club,event,criterion]))[0].id;
    await query("insert into club_event_evaluation_responses(club_id,event_id,event_criterion_id,player_id,respondent_user_id,respondent_role,value_json) values($1,$2,$3,$4,$4,'player','true')",[club,event,link,player]);
    const before=await query('select * from club_event_attendees where event_id=$1',[event]);
    await saveOccurrence(event,await snapshot(event),{},[player,extra],[]);
    assert.deepEqual(await query('select * from club_event_attendees where event_id=$1 and player_id=$2',[event,player]),before);
    assert.equal((await query('select value_json from club_event_evaluation_responses where event_id=$1',[event]))[0].value_json,true);
    assert.equal((await query('select is_enabled from club_event_evaluation_criteria where id=$1',[link]))[0].is_enabled,false);
    const saved=await state(); await assert.rejects(saveOccurrence(event,await snapshot(event),{},[extra]),/evaluated_attendee_removal/); assert.deepEqual(await state(),saved);
    assert.equal((await query('select body from message_threads where event_id=$1',[event]))[0].body,'Keep discussion');
  });
  await t.test('stale planning and late SQL errors never partially save',async()=>{
    const event=await makeEvent(),expected=await snapshot(event);
    await query("update club_events set title='Colleague' where id=$1",[event]); const before=await state();
    await assert.rejects(saveOccurrence(event,expected),/planning_conflict/); assert.deepEqual(await state(),before);
    await assert.rejects(saveOccurrence(event,await snapshot(event),{},[player],[outsider]),/invalid_criteria/); assert.deepEqual(await state(),before);
  });
  await t.test('recurrence keeps IDs, history, individual overrides and cancels excess occurrences',async()=>{
    const series=(await query(`insert into club_event_series(club_id,group_id,event_type,title,weekday,time_of_day,interval_weeks,start_date,end_date,duration_minutes,is_active,created_by)
      values($1,$2,'training','Weekly',1,'10:00',1,'2090-01-01','2090-01-31',60,true,$3) returning id`,[club,group,manager]))[0].id;
    const first=await makeEvent(series,'2090-01-02T10:00Z'), second=await makeEvent(series,'2090-01-09T10:00Z'),third=await makeEvent(series,'2090-01-16T10:00Z');
    await query("update club_events set title='Private override',location_text='Other place' where id=$1",[second]);
    await query("insert into message_threads values($1,'Keep series discussion')",[third]);
    const expected=await snapshot(first), before=await query('select * from club_event_attendees where event_id=any($1::uuid[]) order by event_id',[[first,second,third]]);
    const call=(values)=>query('select update_manager_event_series_v1($1,$2,$3,$4::uuid[],$5::uuid[],$6,$7::uuid[],$8) data',
      [first,JSON.stringify(expected),JSON.stringify({...expected.series,...values,requires_evaluation:true}),[coach],[player],'[]',[],'UTC']);
    await call({title:'New title',time_of_day:'11:00',end_date:'2090-01-10'});
    assert.deepEqual(await query('select * from club_event_attendees where event_id=any($1::uuid[]) order by event_id',[[first,second,third]]),before);
    assert.equal((await query('select title from club_events where id=$1',[first]))[0].title,'New title');
    assert.equal((await query('select title from club_events where id=$1',[second]))[0].title,'Private override');
    assert.equal((await query('select status from club_events where id=$1',[third]))[0].status,'cancelled');
    assert.equal((await query('select body from message_threads where event_id=$1',[third]))[0].body,'Keep series discussion');
    const saved=await state(); await assert.rejects(call({title:'Stale'}),/planning_conflict/); assert.deepEqual(await state(),saved);
  });
  await t.test('failed series generation rolls back all occurrences and template',async()=>{
    const series=(await query(`insert into club_event_series(club_id,group_id,event_type,title,weekday,time_of_day,interval_weeks,start_date,end_date,duration_minutes,is_active,created_by)
      values($1,$2,'training','Weekly',1,'10:00',1,'2090-03-01','2090-03-31',60,true,$3) returning id`,[club,group,manager]))[0].id;
    const event=await makeEvent(series,'2090-03-06T10:00Z'), expected=await snapshot(event),before=await state();
    await assert.rejects(query('select update_manager_event_series_v1($1,$2,$3,$4::uuid[],$5::uuid[],$6,$7::uuid[],$8)',
      [event,JSON.stringify(expected),JSON.stringify(expected.series),[coach],[player],'[]',[outsider],'UTC']),/invalid_criteria/);
    assert.deepEqual(await state(),before);
  });
  await t.test('recurrence extension creates complete titled events across DST without changing the past',async()=>{
    const series=(await query(`insert into club_event_series(club_id,group_id,event_type,title,weekday,time_of_day,interval_weeks,start_date,end_date,duration_minutes,is_active,created_by)
      values($1,$2,'training','Weekly',0,'10:00',1,'2090-03-20','2090-04-10',60,true,$3) returning id`,[club,group,manager]))[0].id;
    const event=await makeEvent(series,'2090-03-26 10:00 Europe/Zurich'),past=await makeEvent(series,'2020-01-01T10:00Z'),expected=await snapshot(event);
    const beforePast=await query('select * from club_events where id=$1',[past]);
    const call=(values)=>query('select update_manager_event_series_v1($1,$2,$3,$4::uuid[],$5::uuid[],$6,$7::uuid[],$8) data',
      [event,JSON.stringify(expected),JSON.stringify({...expected.series,title:'Spring',...values}),[coach],[player,extra],'[]',[criterion],'Europe/Zurich']);
    const before=await state();await assert.rejects(call({end_date:'2093-01-01'}),/series_limit/);assert.deepEqual(await state(),before);
    await call({});
    const future=await query(`select e.id,e.title,(e.starts_at at time zone 'Europe/Zurich')::time::text local_time,
      (select count(*)::int from club_event_attendees where event_id=e.id) participants from club_events e where series_id=$1 and starts_at>'2089-01-01' order by starts_at`,[series]);
    assert.equal(future.length,3);assert.ok(future.every(e=>e.title==='Spring'&&e.local_time==='10:00:00'&&e.participants===2));
    assert.deepEqual(await query('select * from club_events where id=$1',[past]),beforePast);
  });
  await t.test('camp edit retains event/day IDs, registration timestamps and recorded attendance',async()=>{
    const {body,camp}=await makeCamp();
    await query("update club_event_attendees set coach_recorded_status='absent',coach_recorded_by=$2,coach_recorded_at=now() where event_id=$1",[body.days[0].event_id,coach]);
    const attendees=await query('select * from club_event_attendees where event_id=any($1::uuid[]) order by event_id',[body.days.map(d=>d.event_id)]), players=await query('select * from club_camp_players where camp_id=$1',[camp]);
    await saveCamp(camp,await campVersion(camp),{...body,title:'Camp renamed'});
    assert.deepEqual(await query('select * from club_event_attendees where event_id=any($1::uuid[]) order by event_id',[body.days.map(d=>d.event_id)]),attendees);
    assert.deepEqual(await query('select * from club_camp_players where camp_id=$1',[camp]),players);
    assert.equal((await query('select count(*)::int n from club_camp_days where camp_id=$1',[camp]))[0].n,2);
  });
  await t.test('camp removal guard and invalid last option roll back every earlier write',async()=>{
    const {body,camp}=await makeCamp(),version=await campVersion(camp),before=await state();
    await assert.rejects(saveCamp(camp,version,{...body,title:'Must not persist',player_ids:[],player_registrations:[]}),/camp_history_removal/);
    assert.deepEqual(await state(),before);
    await assert.rejects(saveCamp(camp,version,{...body,title:'Must not persist',options:[{name:'Late invalid',input_type:'radio',choices:[],player_assignments:[],day_indexes:[]}]}),/invalid_option/);
    assert.deepEqual(await state(),before);
  });
  await t.test('registration after form load creates conflict without overwriting family response',async()=>{
    const {body,camp}=await makeCamp(),version=await campVersion(camp);
    await query("update club_camp_players set registration_status='declined' where camp_id=$1",[camp]);const before=await state();
    await assert.rejects(saveCamp(camp,version,body),/camp_conflict/);assert.deepEqual(await state(),before);
  });
  await t.test('creation failure leaves no camp, support group or orphan event',async()=>{
    const before=await state(),body=campBody(); body.group_ids=[];body.days[1].ends_at='2089-01-01T10:00Z';
    await assert.rejects(saveCamp(null,null,body),/invalid_days/);assert.deepEqual(await state(),before);
  });
  await t.test('camp reorder keeps day IDs, option day links and option assignment metadata',async()=>{
    const body=campBody();body.options=[{name:'Lunch',input_type:'checkbox',choices:[],applies_to_all_days:false,day_indexes:[0],player_assignments:[{player_id:player,quantity:1,note:'Keep'}]}];
    const saved=(await saveCamp(null,null,body))[0].data,camp=saved.camp_id;
    body.days.forEach((d,i)=>d.event_id=saved.days[i].event_id);
    const option=(await query('select * from club_camp_options where camp_id=$1',[camp]))[0];body.options[0].id=option.id;
    const assignments=await query('select * from club_camp_player_options where option_id=$1',[option.id]);
    const dayLinks=await query('select * from club_camp_option_days where option_id=$1',[option.id]);
    const beforeAttendees=await query('select * from club_event_attendees where event_id=any($1::uuid[]) order by event_id',[body.days.map(d=>d.event_id)]);
    body.days.reverse();body.options[0].day_indexes=[1];body.player_registrations[0].day_status_by_day_index={0:'present',1:'absent'};
    await saveCamp(camp,await campVersion(camp),body);
    assert.deepEqual(await query('select * from club_camp_option_days where option_id=$1',[option.id]),dayLinks);
    assert.deepEqual(await query('select * from club_camp_player_options where option_id=$1',[option.id]),assignments);
    assert.deepEqual(await query('select * from club_event_attendees where event_id=any($1::uuid[]) order by event_id',[body.days.map(d=>d.event_id)]),beforeAttendees);
    await saveCamp(camp,await campVersion(camp),{...body,options:[]});
    assert.equal((await query('select is_active from club_camp_options where id=$1',[option.id]))[0].is_active,false);
    assert.deepEqual(await query('select * from club_camp_player_options where option_id=$1',[option.id]),assignments);
  });
  await t.test('registered camp participants remain expected despite the legacy insert trigger',async()=>{
    const body=campBody();body.player_registrations[0].day_status_by_day_index={};
    const camp=(await saveCamp(null,null,body))[0].data;
    assert.deepEqual((await query('select status from club_event_attendees where event_id=any($1::uuid[])',[camp.days.map(d=>d.event_id)])).map(x=>x.status),['expected','expected']);
  });
  await t.test('archived criterion snapshots can be disabled without deleting existing answers',async()=>{
    const event=await makeEvent();await query('insert into club_event_evaluation_criteria(club_id,event_id,criterion_id,position) values($1,$2,$3,1)',[club,event,criterion]);
    await query('update club_evaluation_criteria set is_active=false,archived_at=now() where id=$1',[criterion]);
    try{await saveOccurrence(event,await snapshot(event));assert.equal((await query('select is_enabled from club_event_evaluation_criteria where event_id=$1',[event]))[0].is_enabled,false);}
    finally{await query('update club_evaluation_criteria set is_active=true,archived_at=null where id=$1',[criterion]);}
  });
  await t.test('standalone camp occurrence preserves attendance while applying participant deltas',async()=>{
    const event=await makeEvent();await query("update club_events set event_type='camp' where id=$1",[event]);
    const before=await query('select * from club_event_attendees where event_id=$1',[event]);
    await saveOccurrence(event,await snapshot(event),{},[player,extra]);
    assert.deepEqual(await query('select * from club_event_attendees where event_id=$1 and player_id=$2',[event,player]),before);
    assert.equal((await query('select count(*)::int n from club_event_attendees where event_id=$1',[event]))[0].n,2);
  });
  await t.test('season cloning is atomic, includes groups and field values, and retains current season after failure',async()=>{
    const source=(await query("insert into club_seasons(club_id,name,starts_on,ends_on,is_current) values($1,'2088','2088-01-01','2088-12-31',true) returning id",[club]))[0].id;
    await query('update coach_groups set club_season_id=$1 where id=$2',[source,group]);
    const record=(await query('insert into club_player_season_records(club_season_id,club_member_id,group_id) select $1,id,$2 from club_members where user_id=$3 returning id',[source,group,player]))[0].id;
    await query('insert into club_player_fields values($1)',[criterion]);await query("insert into club_player_season_field_values values($1,$2,'[\"preserved\"]',now())",[record,criterion]);
    const create=values=>query('select create_manager_season_v1($1,$2,$3) data',[manager,club,JSON.stringify(values)]);
    await db.exec("create function fail_season_value() returns trigger language plpgsql as $$ begin raise exception 'injected_season_failure'; end $$; create trigger fail_season_value before insert on club_player_season_field_values for each row execute function fail_season_value();");
    const before=await state();await assert.rejects(create({name:'2089',starts_on:'2089-01-01',ends_on:'2089-12-31',is_current:true}),/injected_season_failure/);assert.deepEqual(await state(),before);
    await db.exec('drop trigger fail_season_value on club_player_season_field_values');
    const saved=(await create({name:'2089',starts_on:'2089-01-01',ends_on:'2089-12-31',is_current:true}))[0].data;
    assert.equal(saved.copied_records,1);
    const clone=(await query('select * from club_player_season_records where club_season_id=$1',[saved.season.id]))[0];assert.notEqual(clone.group_id,group);
    assert.deepEqual((await query('select value_json from club_player_season_field_values where club_player_season_record_id=$1',[clone.id]))[0].value_json,['preserved']);
    assert.equal((await query('select id from club_seasons where is_current'))[0].id,saved.season.id);
  });
  await t.test('SQL permissions reject foreign, revoked and direct client camp/season mutations',async()=>{
    const event=await makeEvent(),expected=await snapshot(event),before=await state();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);
    await assert.rejects(snapshot(event),/forbidden/);await assert.rejects(saveOccurrence(event,expected),/forbidden/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[manager]);
    await assert.rejects(saveCamp(null,null,campBody(),outsider),/forbidden/);
    await query("update club_members set is_active=false where user_id=$1 and role='manager'",[manager]);
    await assert.rejects(saveCamp(null,null,campBody()),/forbidden/);
    await query("update club_members set is_active=true where user_id=$1 and role='manager'",[manager]);
    await db.exec('set role authenticated');
    await assert.rejects(saveCamp(null,null,campBody()),/permission denied/);
    await assert.rejects(query('select create_manager_season_v1($1,$2,$3)',[manager,club,'{}']),/permission denied/);
    await db.exec('reset role');assert.deepEqual(await state(),before);
  });
  await runManagerEventWrites(t,db,{club,foreignClub,manager,player,coach,outsider,group,extra,criterion});
  await runManagerParticipantEvaluation(t,db,{club,manager,player,coach,outsider,group,criterion,extra});
  await runManagerGlobalActivityWrites(t,db,{club,manager,player,coach,outsider,group,extra});
});
