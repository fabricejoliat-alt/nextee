import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizationDatabase } from './helpers/organizationDatabase.mjs';
import { withoutTransaction } from '../scripts/organizations/migration-bundle.mjs';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [player,parent,coach,outsider,club,academy,session,round,activity,camp,day,section,exercise,attempt,ownedRound] = Array.from({length:15},(_,i)=>id(i+1));
let db, snapshots;
const tables=['auth.users','public.profiles','public.player_guardians','public.training_sessions','public.training_session_items','public.golf_rounds','public.golf_round_holes','public.player_activity_events','public.player_camps','public.player_camp_days','public.player_validation_attempts'];
async function q(sql,args=[]) { return (await db.query(sql,args)).rows; }
async function scalar(sql,args=[]) { return Object.values((await q(sql,args))[0])[0]; }
async function actor(uid,org=club) { await db.exec(`reset role; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${uid}'; set request.headers='{"x-activitee-organization":"${org}"}'; set role authenticated;`); }
async function service() { await db.exec("reset role; set request.jwt.claim.role='service_role'; set request.jwt.claim.sub=''; set request.headers='{}'; set activitee.actor_id='10000000-0000-4000-8000-000000000001';"); }
before(async()=>{
 db=await organizationDatabase({beforeMigrations:async legacy=>{
  await legacy.exec("set request.jwt.claim.role='service_role'; insert into public.legal_enforcement_control(singleton,enabled) values(true,true);");
  for(const [uid,name] of [[player,'Player'],[parent,'Parent'],[coach,'Coach'],[outsider,'Outsider']]) {
   await legacy.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,`${name}@personal.fixtures.invalid`]);
   await legacy.query("insert into public.profiles(id,first_name,last_name,birth_date,username) values($1,$2,'Fixture','1980-01-01',$3)",[uid,name,`personal.${name}`]);
  }
  for(const [org,name] of [[club,'Club'],[academy,'Academy']]) {
   await legacy.query('insert into public.clubs(id,name,slug) values($1,$2,$3)',[org,name,`personal-${name}`]);
   await legacy.query('insert into public.organizations(id,name,slug,org_type) values($1,$2,$3,$4)',[org,name,`personal-${name}`,org===academy?'academy':'club']);
   for(const [uid,role] of [[player,'player'],[parent,'parent'],[coach,'coach']]) await legacy.query('insert into public.club_members(club_id,user_id,role,player_consent_status,is_performance) values($1,$2,$3,$4,true)',[org,uid,role,role==='player'?'adult':null]);
  }
  await legacy.query("update public.organizations set org_type='academy' where id=$1",[academy]);
  await legacy.query("insert into public.player_guardians(player_id,guardian_user_id,relation,is_primary,can_view,can_edit) values($1,$2,'father',true,true,true)",[player,parent]);
  await legacy.query("insert into public.training_sessions(id,user_id,start_at,notes,total_minutes) values($1,$2,now(),'Original individual session',60)",[session,player]);
  await legacy.query("insert into public.training_session_items(session_id,category,minutes,note) values($1,'putting',60,'Original item')",[session]);
  await legacy.query("insert into public.golf_rounds(id,user_id,start_at,notes,om_organization_id) values($1,$2,now(),'Original personal round, scoring org differs',$3)",[round,player,academy]);
  await legacy.query('insert into public.golf_round_holes(round_id,hole_no,par,score) values($1,1,4,5)',[round]);
  await legacy.query('insert into public.golf_rounds(id,user_id,start_at,club_id) values($1,$2,now(),$3)',[ownedRound,player,club]);
  await legacy.query("insert into public.player_activity_events(id,user_id,event_type,title,starts_at,ends_at) values($1,$2,'competition','Original activity',now(),now()+interval '1 hour')",[activity,player]);
  await legacy.query("insert into public.player_camps(id,user_id,title) values($1,$2,'Original personal camp')",[camp,player]);
  await legacy.query("insert into public.player_camp_days(id,camp_id,session_id,starts_at,ends_at) values($1,$2,$3,now(),now()+interval '1 hour')",[day,camp,session]);
  await legacy.query("insert into public.validation_sections(id,slug,name,sort_order) values($1,'personal-fixture','Fixture',1)",[section]);
  await legacy.query("insert into public.validation_exercises(id,section_id,sequence_no,name) values($1,$2,1,'Fixture exercise')",[exercise,section]);
  await legacy.query("insert into public.player_validation_attempts(id,player_id,exercise_id,created_by_user_id,result,note) values($1,$2,$3,$2,'success','Original validation')",[attempt,player,exercise]);
  snapshots={}; for(const table of tables) snapshots[table]=(await legacy.query(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows;
 }});
});
after(async()=>{await db?.close();});
test('migration peuplée: deux affiliations, histoires personnelles intactes, aucune attribution depuis OM',async()=>{
 await service();
 for(const table of tables) assert.deepEqual(await q(`select to_jsonb(t)-'organization_id' row from ${table} t order by (to_jsonb(t)-'organization_id')::text`),snapshots[table],table);
 assert.equal(await scalar("select count(*)::int from public.legal_organization_templates t,jsonb_each(t.translations) tr where tr.value->>'status'='needs_review' and tr.value->>'body' is not null"),12);
 assert.equal(await scalar('select club_id from public.golf_rounds where id=$1',[round]),null);
 assert.equal(await scalar('select club_id from public.golf_rounds where id=$1',[ownedRound]),club);
 assert.equal(await scalar('select om_organization_id from public.golf_rounds where id=$1',[round]),academy);
 assert.equal(await scalar('select organization_id from public.player_validation_attempts where id=$1',[attempt]),null);
 await db.exec(withoutTransaction(readFileSync('supabase/bootstrap/organization-remodel-postflight.sql','utf8')));
});
test('Player: mêmes histoires personnelles dans les deux contextes, données du club isolées',async()=>{
 for(const org of [club,academy]) {
  await actor(player,org);
  assert.equal(await scalar('select count(*)::int from public.golf_rounds where id=$1',[round]),1);
  assert.equal(await scalar('select count(*)::int from public.golf_round_holes where round_id=$1',[round]),1);
  assert.equal(await scalar('select count(*)::int from public.training_session_items where session_id=$1',[session]),1);
  assert.equal(await scalar('select count(*)::int from public.golf_rounds where id=$1',[ownedRound]),org===club?1:0);
  assert.equal(await scalar('select public.personal_player_access($1,$1)',[player]),true);
 }
 const created=await scalar("insert into public.training_sessions(user_id,start_at,notes) values($1,now(),'New personal') returning id",[player]);
 assert.equal(await scalar('select club_id from public.training_sessions where id=$1',[created]),null);
 await assert.rejects(()=>q("insert into public.training_sessions(user_id,start_at,session_type) values($1,now(),'club')",[player]),/required/i);
 await assert.rejects(()=>q('update public.training_sessions set club_id=$1 where id=$2',[academy,created]),/immutable/i);
});
test('Parent: lecture personnelle permise, modification selon droits du contexte; tiers refusé',async()=>{
 await service(); await q('update public.player_guardian_scopes set can_edit=false where organization_id=$1',[academy]);
 await actor(parent,academy);
 assert.equal(await scalar('select count(*)::int from public.golf_rounds where id=$1',[round]),1);
 await assert.rejects(()=>q('select public.save_player_golf_hole_transactional($1,$2)',[round,{hole_no:1,par:4,score:7}]),/forbidden/i);
 await actor(parent,club);
 await q('select public.save_player_golf_hole_transactional($1,$2)',[round,{hole_no:1,par:4,score:6}]);
 assert.equal(await scalar('select score from public.golf_round_holes where round_id=$1',[round]),6);
 await actor(outsider,club);
 assert.equal(await scalar('select count(*)::int from public.golf_rounds'),0);
 assert.equal(await scalar('select count(*)::int from public.training_session_items'),0);
 await assert.rejects(()=>q('select public.save_player_golf_hole_transactional($1,$2)',[round,{hole_no:1,par:4,score:7}]),/forbidden/i);
});
test('Coach affecté: progression personnelle lisible, écriture personnelle interdite',async()=>{
 await service();
 const group=await scalar("insert into public.coach_groups(club_id,name,head_coach_user_id) values($1,'Personal fixture group',$2) returning id",[academy,coach]);
 await q('insert into public.coach_group_players(group_id,player_user_id) values($1,$2)',[group,player]);
 await q('insert into public.coach_group_coaches(group_id,coach_user_id) values($1,$2)',[group,coach]);
 await actor(coach,academy);
 assert.equal(await scalar('select count(*)::int from public.golf_rounds where id=$1',[round]),1);
 assert.equal(await scalar('select public.personal_player_access($1,$2,true)',[player,coach]),false);
 await assert.rejects(()=>q("insert into public.training_sessions(user_id,start_at) values($1,now())",[player]),/forbidden|row-level/i);
 await actor(player,academy);
 const ids=await scalar('select public.create_player_golf_rounds_transactional($1,$2,array[now()],$3)',[player,{round_type:'training',course_source:'manual',course_name:'Personal RPC fixture',om_match_play_wins:0,om_is_exceptional:false,club_id:null,score_entry_mode:'full'},[{hole_no:1,par:4,score:5}]]);
 assert.equal(await scalar('select club_id from public.golf_rounds where id=$1',[ids[0]]),null);
 await q('delete from public.golf_rounds where id=$1',[ids[0]]);
 await service(); assert.equal(await scalar('select count(*)::int from public.golf_round_holes where round_id=$1',[ids[0]]),0);
});
