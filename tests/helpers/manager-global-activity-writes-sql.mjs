import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function runManagerGlobalActivityWrites(t,db,{club,manager,player,coach,outsider,group,extra}) {
 const read=path=>readFileSync(new URL('../../supabase/'+path,import.meta.url),'utf8');
 await db.exec(`alter table club_events add column competition_level text,add column competition_category text,add column external_registration_url text,add column competition_note text;
 create table player_guardians(player_id uuid,guardian_user_id uuid,can_view boolean);
 insert into player_guardians values('${player}','${manager}',true);`);
 const competitions=read('migrations/20260907_add_manager_competitions.sql');
 await db.exec(competitions.slice(0,competitions.indexOf('create table if not exists public.club_event_reminders')));
 await db.exec(competitions.slice(competitions.indexOf('create table if not exists public.club_event_reminders'),competitions.indexOf('create index if not exists club_event_reminders_due_idx')));
 const migration=read('migrations/20261015_manager_global_activity_writes.sql'); await db.exec(migration); await db.exec(migration);
 const query=async(sql,params=[]) => (await db.query(sql,params)).rows;
 const asActor=async(actor,run,role='authenticated')=>{await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[actor,role]);await db.exec(`set role ${role}`);try{return await run();}finally{await db.exec('reset role');}};
 const checks=await query(read('checks/20261015_manager_global_activity_writes_postflight.sql'));assert.equal(checks.length,15);assert.ok(checks.every(x=>x.status==='ok'),JSON.stringify(checks));
 let sequence=15000;
 const body={mode:'single',eventType:'competition',title:'Tournament',startsAt:'2090-07-09T22:00:00Z',endsAt:'2090-07-10T21:59:59Z',competitionStartDate:'2090-07-10',competitionEndDate:'2090-07-10',competitionClubId:club,competitionLevel:'club',competitionCategory:'all',durationMinutes:60,
 groupTarget:{mode:'selected',ids:[]},playerTarget:{mode:'selected',ids:[player]},coachTarget:{mode:'selected',ids:[coach]},parentTarget:{mode:'none',ids:[]},reminder:{enabled:true,scheduledFor:'2090-07-05T07:00Z',channel:'in_app',messageTemplate:'Original'}};
 const create=async(payload=body,request=id(sequence++))=>(await query('select create_manager_activity_batch_v1($1,$2) data',[request,JSON.stringify(payload)]))[0].data;
 const snapshot=async(event)=>(await query('select get_manager_competition_snapshot_v1($1) data',[event]))[0].data;
 const save=async(event,expected,payload=body)=>(await query('select save_manager_competition_v1($1,$2,$3) data',[event,JSON.stringify(expected),JSON.stringify(payload)]))[0].data;
 const state=async()=>{const out={};for(const table of ['coach_groups','coach_group_players','coach_group_coaches','club_events','club_event_series','club_event_attendees','club_event_coaches','club_event_reminders','manager_event_creation_requests','manager_activity_creation_requests']) out[table]=await query(`select * from ${table} order by to_jsonb(${table})::text`);return out;};
 await t.test('global writes reject foreign or inactive managers, invalid recipients and anonymous access',async()=>{
  const before=await state();for(const actor of [outsider,player,coach])await asActor(actor,()=>assert.rejects(create(),/invalid_assignments|forbidden/));
  await asActor(manager,()=>assert.rejects(create({...body,playerTarget:{mode:'selected',ids:[outsider]}}),/invalid_assignments/));
  await asActor(manager,()=>assert.rejects(create(),/permission denied/),'anon');
  await asActor(manager,()=>assert.rejects(query('select * from manager_activity_creation_requests'),/permission denied/));
  await query("update club_members set is_active=false where user_id=$1 and role='manager'",[manager]);await asActor(manager,()=>assert.rejects(create(),/invalid_assignments|forbidden/));await query("update club_members set is_active=true where user_id=$1 and role='manager'",[manager]);assert.deepEqual(await state(),before);
 });
 await t.test('global competition creation is retry-safe and includes reminder and parent recipients',async()=>{
  const key=id(sequence++),result=await asActor(manager,()=>create(body,key));const before=await state();
  assert.equal(result.createdEvents,1);assert.equal(result.events[0].event_type,'competition');assert.deepEqual(new Set(result.events[0].recipient_ids),new Set([player,manager]));
  const current=await asActor(manager,()=>snapshot(result.firstEventId));assert.equal(current.attendees.length,1);assert.equal(current.attendees[0].status,'expected');assert.equal(current.event.requires_evaluation,false);assert.equal(current.reminder.message_template,'Original');
  assert.deepEqual(await asActor(manager,()=>create(body,key)),{...result,replayed:true});
  await asActor(manager,()=>assert.rejects(create({...body,title:'Different'},key),/creation_request_conflict/));assert.deepEqual(await state(),before);
 });
 await t.test('late reminder failure rolls back the private group, event, participants and both retry ledgers',async()=>{
  await db.exec("create function fail_global_reminder() returns trigger language plpgsql as $$ begin raise exception 'late_reminder_failure'; end $$;create trigger fail_global_reminder before insert or update on club_event_reminders for each row execute function fail_global_reminder();");
  const before=await state();await asActor(manager,()=>assert.rejects(create(),/late_reminder_failure/));assert.deepEqual(await state(),before);await db.exec('drop trigger fail_global_reminder on club_event_reminders');
 });
 await t.test('competition edits retain attendee metadata and reminder IDs while detecting stale drafts',async()=>{
  const result=await asActor(manager,()=>create()),event=result.firstEventId;
  await query("update club_event_attendees set status='absent',coach_recorded_status='absent',coach_recorded_by=$2,coach_recorded_at=now() where event_id=$1",[event,coach]);
  const original=await asActor(manager,()=>snapshot(event));
  await asActor(manager,()=>save(event,original,{...body,title:'Updated',playerTarget:{mode:'selected',ids:[player,extra]},reminder:{...body.reminder,messageTemplate:'Changed'}}));
  const current=await asActor(manager,()=>snapshot(event));assert.deepEqual(current.attendees.find(x=>x.player_id===player),original.attendees[0]);assert.equal(current.reminder.id,original.reminder.id);assert.equal(current.reminder.message_template,'Changed');assert.equal(current.attendees.length,2);
  const before=await state();await asActor(manager,()=>assert.rejects(save(event,original),/competition_conflict/));assert.deepEqual(await state(),before);
  await asActor(manager,()=>assert.rejects(save(event,current,{...body,playerTarget:{ids:[extra]}}),/evaluated_attendee_removal/));assert.deepEqual(await state(),before);
  for(const actor of [outsider,coach,player])await asActor(actor,()=>assert.rejects(save(event,current),/forbidden/));assert.deepEqual(await state(),before);
 });
 await t.test('a failed competition edit rolls back prior event and roster modifications',async()=>{
  const result=await asActor(manager,()=>create()),expected=await asActor(manager,()=>snapshot(result.firstEventId));
  await db.exec('create trigger fail_global_reminder before update on club_event_reminders for each row execute function fail_global_reminder()');
  const before=await state();await asActor(manager,()=>assert.rejects(save(result.firstEventId,expected,{...body,title:'Must roll back',playerTarget:{ids:[extra]}}),/late_reminder_failure/));assert.deepEqual(await state(),before);await db.exec('drop trigger fail_global_reminder on club_event_reminders');
 });
 await t.test('editing preserves shared groups and processed reminders',async()=>{
  const result=await asActor(manager,()=>create()),event=result.firstEventId;
  await query('update club_events set group_id=$2 where id=$1',[event,group]);await query("update club_event_reminders set status='sent',sent_at=now(),attempt_count=1 where event_id=$1",[event]);
  const expected=await asActor(manager,()=>snapshot(event));
  await asActor(manager,()=>save(event,expected,{...body,title:'Rename',playerTarget:{ids:[extra]},reminder:{enabled:false}}));
  const next=await asActor(manager,()=>snapshot(event));for(const key of ['group','group_players','group_coaches','reminder'])assert.deepEqual(next[key],expected[key]);
 });
 await t.test('global recurring activities preserve Zurich time and roll back every group after a late failure',async()=>{
  await query('insert into coach_group_players values($1,$2) on conflict do nothing',[group,player]);await query('insert into coach_group_coaches values($1,$2,true) on conflict do nothing',[group,coach]);
  const other=(await query("insert into coach_groups(club_id,club_season_id,name) select club_id,club_season_id,'Second' from coach_groups where id=$1 returning id",[group]))[0].id;
  await query('insert into coach_group_players values($1,$2)',[other,player]);await query('insert into coach_group_coaches values($1,$2,true)',[other,coach]);
  const payload={...body,eventType:'training',mode:'series',groupTarget:{mode:'selected',ids:[group,other]},series:{startDate:'2090-03-19',endDate:'2090-04-02',weekday:new Date('2090-03-19T12:00Z').getUTCDay(),timeOfDay:'10:00',intervalWeeks:1}};
  const result=await asActor(manager,()=>create(payload));assert.equal(result.createdEvents,6);assert.equal(result.createdSeries,2);
  assert.ok((await query("select (starts_at at time zone 'Europe/Zurich')::time::text local from club_events where id=any($1::uuid[])",[result.events.map(x=>x.id)])).every(x=>x.local==='10:00:00'));
  await db.exec(`create function fail_last_global_group() returns trigger language plpgsql as $$ begin if new.group_id='${[group,other].sort()[1]}' then raise exception 'late_group_failure'; end if;return new;end $$;create trigger fail_last_global_group before insert on club_events for each row execute function fail_last_global_group();`);
  const before=await state();await asActor(manager,()=>assert.rejects(create(payload),/late_group_failure/));assert.deepEqual(await state(),before);await db.exec('drop trigger fail_last_global_group on club_events');
  await asActor(manager,()=>assert.rejects(create({...payload,durationMinutes:600}),/invalid_event/));assert.deepEqual(await state(),before);
 });
}
