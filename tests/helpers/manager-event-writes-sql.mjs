import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function runManagerEventWrites(t,db,{club,foreignClub,manager,player,coach,outsider,group,extra,criterion}) {
 await db.exec("create or replace function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$");
 const migration=readFileSync(new URL('../../supabase/migrations/20261013_manager_event_writes.sql',import.meta.url),'utf8');
 await db.exec(migration); await db.exec(migration);
 const checks=(await db.query(readFileSync(new URL('../../supabase/checks/20261013_manager_event_writes_postflight.sql',import.meta.url),'utf8'))).rows;
 assert.equal(checks.length,12);assert.ok(checks.every(x=>x.status==='ok'),JSON.stringify(checks));
 const query=async(sql,params=[]) => (await db.query(sql,params)).rows;
 const asActor=async(actor,run,role='authenticated')=>{await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[actor,role]);await db.exec(`set role ${role}`);try{return await run();}finally{await db.exec('reset role');}};
 const single={event_type:'training',starts_at:'2090-03-19T09:00Z',ends_at:'2090-03-19T10:00Z',duration_minutes:60,requires_evaluation:true};
 const recurring={event_type:'training',start_date:'2090-03-19',end_date:'2090-04-02',weekday:new Date('2090-03-19T12:00Z').getUTCDay(),time_of_day:'10:00',interval_weeks:1,duration_minutes:60,requires_evaluation:true};
 let sequence=9000;
 const create=async(opts={})=>(await query('select create_manager_events_v1($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7,$8::uuid[]) result',[opts.request??id(sequence++),opts.group??group,opts.mode??'single',JSON.stringify(opts.template??single),[coach],opts.players??[player],JSON.stringify(opts.structure??[{category:'putting',minutes:30,note:'Texte conservé'}]),opts.criteria??[criterion]]))[0].result;
 const remove=async(eventId=null,seriesId=null,actor=manager,confirmed=true)=>(await query('select delete_manager_planning_v1($1,$2,$3,$4) result',[actor,eventId,seriesId,confirmed]))[0].result;
 const state=async()=> (await query(`select jsonb_build_object('events',(select jsonb_agg(x order by id) from club_events x),'series',(select jsonb_agg(x order by id) from club_event_series x),'attendees',(select jsonb_agg(x order by event_id,player_id) from club_event_attendees x),'coaches',(select jsonb_agg(x order by event_id,coach_id) from club_event_coaches x),'structure',(select jsonb_agg(x order by id) from club_event_structure_items x),'criteria',(select jsonb_agg(x order by id) from club_event_evaluation_criteria x),'requests',(select jsonb_agg(x order by request_id) from manager_event_creation_requests x)) data`))[0].data;
 await t.test('Manager creation rejects coaches, foreign members, inactive managers and client retry-table access',async()=>{
  const before=await state(); for(const actor of [coach,player,outsider]) await asActor(actor,()=>assert.rejects(create(),/forbidden/));
  await asActor(manager,()=>assert.rejects(create({players:[outsider]}),/invalid_assignments/));
  await asActor(manager,()=>assert.rejects(query('select * from manager_event_creation_requests'),/permission denied/));
  await asActor(manager,()=>assert.rejects(create(),/permission denied/),'anon');
  await query("update club_members set is_active=false where user_id=$1 and role='manager'",[manager]);await asActor(manager,()=>assert.rejects(create(),/forbidden/));await query("update club_members set is_active=true where user_id=$1 and role='manager'",[manager]);
  assert.deepEqual(await state(),before);
 });
 await t.test('creation saves exactly selected participants, evaluation settings, criteria snapshots and every Zurich occurrence',async()=>{
  const result=await asActor(manager,()=>create({mode:'series',template:recurring,players:[extra]}));assert.equal(result.event_ids.length,3);
  const rows=await query("select requires_evaluation,(starts_at at time zone 'Europe/Zurich')::time::text time from club_events where id=any($1::uuid[])",[result.event_ids]);assert.ok(rows.every(x=>x.requires_evaluation&&x.time==='10:00:00'));
  const attendees=await query('select player_id,coach_recorded_status from club_event_attendees where event_id=any($1::uuid[])',[result.event_ids]);assert.equal(attendees.length,3);assert.ok(attendees.every(x=>x.player_id===extra&&x.coach_recorded_status===null));
  const criteria=await query('select criterion_id,snapshot_name from club_event_evaluation_criteria where event_id=any($1::uuid[])',[result.event_ids]);assert.equal(criteria.length,3);assert.ok(criteria.every(x=>x.criterion_id===criterion&&x.snapshot_name==='Test'));
 });
 await t.test('retry returns the same IDs and cannot silently change criteria or participants',async()=>{
  const request=id(sequence++),first=await asActor(manager,()=>create({request})),before=await state();
  assert.deepEqual(await asActor(manager,()=>create({request})),{...first,replayed:true});
  await asActor(manager,()=>assert.rejects(create({request,criteria:[]}),/creation_request_conflict/));assert.deepEqual(await state(),before);
 });
 await t.test('invalid criteria and a late occurrence failure roll back the whole creation including the retry key',async()=>{
  const before=await state();await asActor(manager,()=>assert.rejects(create({criteria:[id(999)]}),/invalid_criteria/));assert.deepEqual(await state(),before);
  await db.exec(`create function reject_second_manager_occurrence() returns trigger language plpgsql as $$ begin if (select count(*) from public.club_events where series_id=new.series_id)>0 then raise exception 'late_creation_failure'; end if; return new; end $$;create trigger reject_second_manager before insert on club_events for each row execute function reject_second_manager_occurrence();`);
  await asActor(manager,()=>assert.rejects(create({mode:'series',template:recurring}),/late_creation_failure/));assert.deepEqual(await state(),before);await db.exec('drop trigger reject_second_manager on club_events');
  await asActor(manager,()=>assert.rejects(create({mode:'series',template:{...recurring,end_date:'2093-03-19'}}),/too_many_occurrences/));assert.deepEqual(await state(),before);
 });
 await t.test('deletion requires the server role, an active manager and explicit occurrence scope',async()=>{
  const created=await asActor(manager,()=>create({mode:'series',template:recurring})),before=await state();
  await asActor(manager,()=>assert.rejects(remove(created.event_ids[0]),/permission denied/));
  for(const actor of [coach,outsider]) await asActor(actor,()=>assert.rejects(remove(created.event_ids[0],null,actor),/forbidden/),'service_role');
  await asActor(manager,()=>assert.rejects(remove(created.event_ids[0],null,manager,false),/occurrence_confirmation_required/),'service_role');assert.deepEqual(await state(),before);
 });
 await t.test('a late deletion failure preserves every participant, structure, criterion and activity',async()=>{
  const created=await asActor(manager,()=>create()),eventId=created.event_ids[0];await db.exec(`create function fail_manager_delete() returns trigger language plpgsql as $$ begin raise exception 'late_delete_failure'; end $$;create trigger fail_manager_delete before delete on club_events for each row execute function fail_manager_delete();`);
  const before=await state();await asActor(manager,()=>assert.rejects(remove(eventId),/late_delete_failure/),'service_role');assert.deepEqual(await state(),before);await db.exec('drop trigger fail_manager_delete on club_events');
  const deleted=await asActor(manager,()=>remove(eventId),'service_role');assert.equal(deleted.deleted_events,1);assert.deepEqual(await query('select id from club_events where id=$1',[eventId]),[]);assert.deepEqual(await query('select id from club_event_evaluation_criteria where event_id=$1',[eventId]),[]);
 });
 await t.test('series deletion cannot cross clubs and still supports Manager-only competitions without a group',async()=>{
  const created=await asActor(manager,()=>create({mode:'series',template:recurring}));await query('update club_events set club_id=$1 where id=$2',[foreignClub,created.event_ids[1]]);const before=await state();
  await asActor(manager,()=>assert.rejects(remove(null,created.series_id),/forbidden/),'service_role');assert.deepEqual(await state(),before);
  await query('update club_events set club_id=$1 where id=$2',[club,created.event_ids[1]]);const deleted=await asActor(manager,()=>remove(null,created.series_id),'service_role');assert.equal(deleted.deleted_events,3);
  const competition=(await query("insert into club_events(club_id,event_type,starts_at) values($1,'competition','2099-01-01') returning id",[club]))[0].id;
  assert.equal((await asActor(manager,()=>remove(competition),'service_role')).deleted_events,1);
 });
 await query("select set_config('request.jwt.claim.sub',$1,false)",[manager]);
}
