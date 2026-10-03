import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export async function runManagerParticipantEvaluation(t,db,{club,manager,player,coach,outsider,group,criterion,extra}) {
 const sql=file=>readFileSync(new URL(`../../supabase/${file}`,import.meta.url),'utf8');
 await db.exec(`alter table club_event_coach_feedback add column engagement int,add column attitude int,add column performance int,add column visible_to_player boolean,add column player_note text;
 create unique index manager_feedback_test_unique on club_event_coach_feedback(event_id,player_id,coach_id);`);
 await db.exec(sql('migrations/20261002_harden_coach_security_batch1.sql').match(/create or replace function public\.save_manager_event_feedback_v1\([\s\S]*?\$\$;/)[0]);
 await db.exec(sql('migrations/20261014_manager_participant_evaluation.sql'));await db.exec(sql('migrations/20261014_manager_participant_evaluation.sql'));
 const checks=(await db.query(sql('checks/20261014_manager_participant_evaluation_postflight.sql'))).rows;assert.equal(checks.length,11);assert.ok(checks.every(r=>r.status==='ok'),JSON.stringify(checks));
 const query=async(s,p=[]) => (await db.query(s,p)).rows;
 const actor=async(id,run,role='authenticated')=>{await query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);try{return await run();}finally{await db.exec('reset role');}};
 const snapshot=async(event)=>(await query('select get_manager_evaluation_snapshot_v1($1,$2) data',[event,player]))[0].data;
 const create=async()=>{
  const event=(await query("insert into club_events(club_id,group_id,starts_at,ends_at,duration_minutes,requires_evaluation) values($1,$2,'2020-01-01T10:00Z','2020-01-01T11:00Z',60,true) returning id",[club,group]))[0].id;
  await query("insert into club_event_attendees(event_id,player_id,status) values($1,$2,'expected')",[event,player]);
  const link=(await query('insert into club_event_evaluation_criteria(club_id,event_id,criterion_id,position) values($1,$2,$3,1) returning id',[club,event,criterion]))[0].id;
  await query('update club_event_evaluation_criteria set snapshot_is_required=true where id=$1',[link]);return {event,link};
 };
 const values=link=>({attendance:'present',feedback:{engagement:4,attitude:5,performance:6,visible_to_player:true,player_note:'Keep practising',private_note:'Private staff note'},responses:{[link]:true}});
 const save=async(event,expected,body)=>(await query('select save_manager_event_feedback_v2($1,$2,$3,$4) data',[event,player,JSON.stringify(expected),JSON.stringify(body)]))[0].data;
 await t.test('participant snapshots and saves deny coaches, foreign members, inactive managers, anonymous users and non-attendees',async()=>{
  const {event,link}=await create();const expected=await actor(manager,()=>snapshot(event));
  for(const who of [coach,outsider]){await actor(who,()=>assert.rejects(snapshot(event),/forbidden/));await actor(who,()=>assert.rejects(save(event,expected,values(link)),/forbidden/));}
  await actor(manager,()=>assert.rejects(snapshot(event),/permission denied/),'anon');
  await query("update club_members set is_active=false where user_id=$1 and role='manager'",[manager]);await actor(manager,()=>assert.rejects(snapshot(event),/forbidden/));await query("update club_members set is_active=true where user_id=$1 and role='manager'",[manager]);
  await actor(manager,()=>assert.rejects(query('select get_manager_evaluation_snapshot_v1($1,$2)',[event,extra]),/unknown_attendee/));assert.deepEqual(await actor(manager,()=>snapshot(event)),expected);
 });
 await t.test('one evaluation records manual attendance, all ratings and criteria while preserving player answers and other coaches',async()=>{
  const {event,link}=await create();await query("insert into club_event_coach_feedback(event_id,player_id,coach_id,private_note) values($1,$2,$3,'Other coach private note')",[event,player,coach]);
  await query("insert into club_event_evaluation_responses(club_id,event_id,event_criterion_id,player_id,respondent_user_id,respondent_role,value_json) values($1,$2,$3,$4,$4,'player','false')",[club,event,link,player]);
  const result=await actor(manager,async()=>save(event,await snapshot(event),values(link)));assert.equal(result.ok,true);assert.equal(result.notification_required,true);
  const saved=await actor(manager,()=>snapshot(event));assert.equal(saved.attendee.coach_recorded_status,'present');assert.equal(saved.attendee.coach_recorded_by,manager);assert.ok(saved.attendee.coach_recorded_at);
  assert.equal(saved.feedback.length,2);assert.equal(saved.feedback[0].coach_id,manager);assert.equal(saved.feedback[1].private_note,'Other coach private note');assert.equal(saved.responses[0].value_json,true);
  assert.equal((await query("select value_json from club_event_evaluation_responses where event_id=$1 and respondent_role='player'",[event]))[0].value_json,false);
 });
 await t.test('private-only edits and hidden evaluations never request a player notification',async()=>{
  const {event,link}=await create();await actor(manager,async()=>save(event,await snapshot(event),values(link)));
  let body=values(link);body.feedback.private_note='Changed private note';assert.equal((await actor(manager,async()=>save(event,await snapshot(event),body))).notification_required,false);
  body.feedback.visible_to_player=false;body.feedback.player_note='Hidden comment';assert.equal((await actor(manager,async()=>save(event,await snapshot(event),body))).notification_required,false);
 });
 await t.test('required attendance, ratings and custom answers are validated before writes; future/cancelled/disabled events refuse edits',async()=>{
  const {event,link}=await create(),expected=await actor(manager,()=>snapshot(event));
  for(const [body,error]of [[{...values(link),attendance:null},/attendance_required/],[{...values(link),feedback:{...values(link).feedback,engagement:null}},/ratings_required/],[{...values(link),responses:{}},/required_criteria_missing/],[{...values(link),responses:{[link]:'invalid'}},/invalid_custom_response/],[{...values(link),responses:{[outsider]:true}},/invalid_custom_criterion/]]){
   await actor(manager,()=>assert.rejects(save(event,expected,body),error));assert.deepEqual(await actor(manager,()=>snapshot(event)),expected);
  }
  for(const [patch,error]of [["status='cancelled'",/event_cancelled/],["status='scheduled',requires_evaluation=false",/evaluation_disabled/],["requires_evaluation=true,ends_at='2090-01-01'",/event_not_finished/]]){await query(`update club_events set ${patch} where id=$1`,[event]);const before=await actor(manager,()=>snapshot(event));await actor(manager,()=>assert.rejects(save(event,before,values(link)),error));assert.deepEqual(await actor(manager,()=>snapshot(event)),before);}
 });
 await t.test('concurrent attendance or criterion changes conflict without erasing the newer work',async()=>{
  const {event,link}=await create(),expected=await actor(manager,()=>snapshot(event));await query("update club_event_attendees set status='excused' where event_id=$1",[event]);const before=await actor(manager,()=>snapshot(event));
  await actor(manager,()=>assert.rejects(save(event,expected,values(link)),/evaluation_conflict/));assert.deepEqual(await actor(manager,()=>snapshot(event)),before);
  await query("update club_event_evaluation_criteria set snapshot_name='Changed' where id=$1",[link]);await actor(manager,()=>assert.rejects(save(event,before,values(link)),/evaluation_conflict/));
 });
 await t.test('a late custom-answer failure rolls back feedback and recorded attendance; absence retains the private note',async()=>{
  const {event,link}=await create(),expected=await actor(manager,()=>snapshot(event));
  await db.exec("create function reject_manager_answer() returns trigger language plpgsql as $$ begin raise exception 'late_answer_failure'; end $$; create trigger reject_manager_answer before insert on club_event_evaluation_responses for each row execute function reject_manager_answer();");
  await actor(manager,()=>assert.rejects(save(event,expected,values(link)),/late_answer_failure/));assert.deepEqual(await actor(manager,()=>snapshot(event)),expected);await db.exec('drop trigger reject_manager_answer on club_event_evaluation_responses');
  await actor(manager,async()=>save(event,await snapshot(event),values(link)));
  const result=await actor(manager,async()=>save(event,await snapshot(event),{...values(link),attendance:'absent'}));assert.equal(result.notification_required,false);
  const saved=await actor(manager,()=>snapshot(event));assert.equal(saved.attendee.coach_recorded_status,'absent');assert.equal(saved.feedback[0].engagement,null);assert.equal(saved.feedback[0].visible_to_player,false);assert.equal(saved.feedback[0].player_note,null);assert.equal(saved.feedback[0].private_note,'Private staff note');assert.equal(saved.responses.length,0);
 });
 await query("select set_config('request.jwt.claim.sub',$1,false)",[manager]);
}
