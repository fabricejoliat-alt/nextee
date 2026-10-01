import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export async function runOccurrenceSqlTests(t, db, ids, asActor) {
  const { clubA, clubB, coach, player, manager, other, revoked, groupA } = ids;
  const migration = readFileSync(new URL("../../supabase/migrations/20261004_coach_occurrence_save.sql", import.meta.url), "utf8");
  await db.exec(`alter table club_camp_days add column starts_at timestamptz, add column ends_at timestamptz,
    add column location_text text, add column updated_at timestamptz default now();`);
  await db.exec(migration); await db.exec(migration);
  const newcomer=uuid(500), foreign=uuid(501), unassignedCoach=uuid(502);
  await db.query("insert into club_members(club_id,user_id,role,is_active) values($1,$2,'player',true),($3,$4,'player',true)",[clubA,newcomer,clubB,foreign]);
  await db.query("insert into club_members(club_id,user_id,role,is_active) values($1,$2,'coach',true)",[clubA,unassignedCoach]);
  let sequence=600;
  const expected = async (id) => (await db.query(`select jsonb_build_object('event',to_jsonb(e),
    'coach_ids',coalesce((select jsonb_agg(coach_id order by coach_id) from club_event_coaches where event_id=e.id),'[]'),
    'player_ids',coalesce((select jsonb_agg(player_id order by player_id) from club_event_attendees where event_id=e.id),'[]'),
    'structure',coalesce((select jsonb_agg(jsonb_build_object('category',category,'minutes',minutes,'note',note,'position',position) order by position) from club_event_structure_items where event_id=e.id),'[]'),
    'camp_day',(select jsonb_build_object('camp_id',camp_id,'day_index',day_index,'starts_at',starts_at,'ends_at',ends_at,'location_text',location_text)
      from club_camp_days where event_id=e.id)) snapshot from club_events e where id=$1`,[id])).rows[0].snapshot;
  const snapshot = async(id) => (await db.query(`select jsonb_build_object('event',to_jsonb(e),
    'coaches',(select jsonb_agg(c order by coach_id) from club_event_coaches c where event_id=e.id),
    'attendees',(select jsonb_agg(a order by player_id) from club_event_attendees a where event_id=e.id),
    'structure',(select jsonb_agg(s order by id) from club_event_structure_items s where event_id=e.id),
    'individual',(select jsonb_agg(i) from club_event_player_structure_items i where event_id=e.id),
    'feedback',(select jsonb_agg(f order by coach_id,player_id) from club_event_coach_feedback f where event_id=e.id),
    'responses',(select jsonb_agg(r order by id) from club_event_evaluation_responses r where event_id=e.id),
    'notes',(select jsonb_agg(n) from coach_player_private_notes n where event_id=e.id),
    'threads',(select jsonb_agg(m) from message_threads m where event_id=e.id),
    'camp',(select jsonb_agg(d) from club_camp_days d where event_id=e.id)) state from club_events e where id=$1`,[id])).rows[0].state;
  async function fixture(type="training") {
    const id=uuid(sequence++);
    await db.query(`insert into club_events(id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note)
      values($1,$2,$3,$4,'Occurrence title','2020-01-01 10:00Z','2020-01-01 11:00Z',60,'Old place','Occurrence note')`,[id,groupA,clubA,type]);
    await db.query("insert into club_event_coaches(event_id,coach_id) values($1,$2)",[id,coach]);
    await db.query("insert into club_event_attendees(event_id,player_id,status) values($1,$2,'absent')",[id,player]);
    await db.query("insert into club_event_structure_items(event_id,category,minutes,note,position) values($1,'putting',30,'Original structure',0)",[id]);
    await db.query("insert into message_threads(event_id,body) values($1,'Keep discussion')",[id]);
    if(type==='camp') {
      const camp=uuid(sequence++);
      await db.query("insert into club_camps(id,club_id,title) values($1,$2,'Camp')",[camp,clubA]);
      await db.query("insert into club_camp_days(camp_id,event_id,day_index,starts_at,ends_at,location_text) values($1,$2,0,'2020-01-01 10:00Z','2020-01-01 11:00Z','Old place')",[camp,id]);
    }
    const initial=await expected(id);
    const changes={...initial.event,title:"Updated occurrence",location_text:"New place"};
    const call=(opts={})=>db.query("select update_coach_event_occurrence_v1($1,$2::jsonb,$3::jsonb,$4::uuid[],$5::uuid[],$6::jsonb) result",[
      id,JSON.stringify(opts.expected??initial),JSON.stringify({...changes,...opts.changes}),opts.coaches??[coach],
      Object.hasOwn(opts,'players')?opts.players:type==='camp'?null:[player],
      JSON.stringify(opts.structure??[{category:'putting',minutes:45,note:'Updated structure'}])]);
    return {id,initial,call};
  }

  await t.test("occurrence transaction checks active planning permission and same-club assignments",async()=>{
    const f=await fixture(), before=await snapshot(f.id);
    for(const actor of [revoked,other,player,unassignedCoach]) await asActor(actor,()=>assert.rejects(f.call(),/forbidden/));
    await asActor(coach,()=>assert.rejects(f.call(),/permission denied/),'anon');
    await db.query("update club_members set can_manage_assigned_group_planning=false where club_id=$1 and user_id=$2",[clubA,coach]);
    await asActor(coach,()=>assert.rejects(f.call(),/forbidden/));
    await db.query("update club_members set can_manage_assigned_group_planning=true where club_id=$1 and user_id=$2",[clubA,coach]);
    await asActor(coach,async()=>{
      await assert.rejects(f.call({players:[foreign]}),/invalid_assignments/);
      await assert.rejects(f.call({coaches:[revoked]}),/invalid_assignments/);
    });
    assert.deepEqual(await snapshot(f.id),before);
    await asActor(manager,()=>f.call());
  });
  await t.test("occurrence save preserves attendance metadata, feedback, answers, notes and discussion",async()=>{
    const f=await fixture();
    await db.query("update club_event_attendees set coach_recorded_status='absent',coach_recorded_by=$2,coach_recorded_at='2020-01-02' where event_id=$1",[f.id,coach]);
    await db.query("insert into club_event_coach_feedback(event_id,player_id,coach_id,private_note,player_note) values($1,$2,$3,'Private retained','Shared retained')",[f.id,player,coach]);
    await db.query("insert into coach_player_private_notes(event_id,player_id,organization_id,body) values($1,$2,$3,'Private retained')",[f.id,player,clubA]);
    await db.query("insert into club_event_player_structure_items(event_id,player_id,note) values($1,$2,'Individual retained')",[f.id,player]);
    const criterion=uuid(sequence++);
    await db.query("insert into club_event_evaluation_criteria(id,club_id,event_id,criterion_id,position) values($1,$2,$3,$4,1)",[criterion,clubA,f.id,uuid(60)]);
    await db.query("insert into club_event_evaluation_responses(club_id,event_id,event_criterion_id,player_id,respondent_user_id,respondent_role,value_json) values($1,$2,$3,$4,$4,'player','true')",[clubA,f.id,criterion,player]);
    const before=await snapshot(f.id);
    let result;
    await asActor(coach,async()=>{result=await f.call({players:[player,newcomer,newcomer],coaches:[coach,coach]});});
    const after=await snapshot(f.id);
    assert.deepEqual(after.attendees.find(a=>a.player_id===player),before.attendees[0]);
    for(const key of ['feedback','responses','notes','threads','individual']) assert.deepEqual(after[key],before[key]);
    assert.equal(after.attendees.length,2); assert.equal(after.coaches.length,1);
    assert.equal(after.attendees.find(a=>a.player_id===newcomer).coach_recorded_status,null);
    assert.deepEqual(result.rows[0].result.recipient_ids,[newcomer]);
  });
  await t.test("each kind of recorded player work prevents removal without any partial changes",async()=>{
    for(const kind of ['attendance','feedback','individual','note','response']) {
      const f=await fixture();
      if(kind==='attendance') await db.query("update club_event_attendees set coach_recorded_status='present' where event_id=$1",[f.id]);
      if(kind==='feedback') await db.query("insert into club_event_coach_feedback(event_id,player_id,coach_id) values($1,$2,$3)",[f.id,player,coach]);
      if(kind==='individual') await db.query("insert into club_event_player_structure_items(event_id,player_id,note) values($1,$2,'Individual')",[f.id,player]);
      if(kind==='note') await db.query("insert into coach_player_private_notes(event_id,player_id,organization_id,body) values($1,$2,$3,'Private')",[f.id,player,clubA]);
      if(kind==='response') {
        const criterion=uuid(sequence++);
        await db.query("insert into club_event_evaluation_criteria(id,club_id,event_id,criterion_id,position) values($1,$2,$3,$4,1)",[criterion,clubA,f.id,uuid(60)]);
        await db.query("insert into club_event_evaluation_responses(club_id,event_id,event_criterion_id,player_id,respondent_user_id,respondent_role,value_json) values($1,$2,$3,$4,$4,'player','false')",[clubA,f.id,criterion,player]);
      }
      const before=await snapshot(f.id);
      await asActor(coach,()=>assert.rejects(f.call({players:[]}),/evaluated_attendee_removal/));
      assert.deepEqual(await snapshot(f.id),before,kind);
    }
  });
  await t.test("stale event fields, coaches, roster, structure and camp days reject a stale form",async()=>{
    for(const kind of ['event','coaches','attendees','structure','camp','removed-camp-day']) {
      const f=await fixture(kind.includes('camp')?'camp':'training');
      if(kind==='event') await db.query("update club_events set title='Colleague edit' where id=$1",[f.id]);
      if(kind==='coaches') await db.query("insert into club_event_coaches(event_id,coach_id) values($1,$2)",[f.id,manager]);
      if(kind==='attendees') await db.query("insert into club_event_attendees(event_id,player_id,status) values($1,$2,'present')",[f.id,newcomer]);
      if(kind==='structure') await db.query("update club_event_structure_items set note='Colleague edit' where event_id=$1",[f.id]);
      if(kind==='camp') await db.query("update club_camp_days set location_text='Colleague edit' where event_id=$1",[f.id]);
      if(kind==='removed-camp-day') await db.query("delete from club_camp_days where event_id=$1",[f.id]);
      const before=await snapshot(f.id);
      await asActor(coach,()=>assert.rejects(f.call(),/planning_conflict/));
      assert.deepEqual(await snapshot(f.id),before,kind);
    }
  });
  await t.test("a late occurrence failure rolls back event, coaches, participants, structure and camp day",async()=>{
    for(const type of ['training','camp']) {
      const f=await fixture(type),before=await snapshot(f.id);
      await db.exec(`create or replace function fail_occurrence_structure_test() returns trigger language plpgsql as $$ begin raise exception 'injected_failure'; end $$;
        create trigger fail_occurrence_structure before insert on club_event_structure_items for each row execute function fail_occurrence_structure_test();`);
      await asActor(coach,()=>assert.rejects(f.call({coaches:[manager],players:type==='camp'?null:[newcomer]}),/injected_failure/));
      assert.deepEqual(await snapshot(f.id),before);
      await db.exec("drop trigger fail_occurrence_structure on club_event_structure_items");
    }
  });
  await t.test("camp save synchronizes its day without changing registrations or attendance",async()=>{
    const f=await fixture('camp'),before=await snapshot(f.id);
    await asActor(coach,async()=>{
      await assert.rejects(f.call({players:[]}),/invalid_assignments/);
      await assert.rejects(f.call({changes:{event_type:'training'}}),/use_camp_editor/);
      await f.call({changes:{starts_at:'2020-01-02T10:00:00Z',ends_at:'2020-01-02T11:00:00Z'}});
    });
    const after=await snapshot(f.id);
    assert.deepEqual(after.attendees,before.attendees);
    assert.equal(after.camp[0].location_text,after.event.location_text);
    assert.equal(after.camp[0].starts_at,after.event.starts_at);
  });
  await t.test("invalid date, title, duration and incomplete structure never mutate the occurrence",async()=>{
    const f=await fixture(), before=await snapshot(f.id);
    await asActor(coach,async()=>{
      for(const changes of [{ends_at:'2019-01-01'},{duration_minutes:15},{event_type:'event',title:''}]) {
        await assert.rejects(f.call({changes}),/invalid_event|title_required/);
      }
      for(const structure of [[{category:'',minutes:30}],[{category:'putting',minutes:0}],[{category:'unexpected',minutes:30}]]) {
        await assert.rejects(f.call({structure}),/invalid_structure/);
      }
    });
    assert.deepEqual(await snapshot(f.id),before);
  });
  await t.test("an identical stale request cannot apply a second save after a committed change",async()=>{
    const f=await fixture();
    await asActor(coach,()=>f.call());
    const saved=await snapshot(f.id);
    await asActor(coach,()=>assert.rejects(f.call(),/planning_conflict/));
    assert.deepEqual(await snapshot(f.id),saved);
  });
  await t.test("camp notification recipients exclude cancelled registrations even when an old roster remains",async()=>{
    const f=await fixture('camp');
    await db.query("update club_event_attendees set status='present' where event_id=$1",[f.id]);
    await db.query("insert into club_camp_players(camp_id,player_id,registration_status) select camp_id,$2,'cancelled' from club_camp_days where event_id=$1",[f.id,player]);
    await asActor(coach,async()=>assert.deepEqual((await f.call()).rows[0].result.recipient_ids,[]));
    await db.query("update club_camp_players set registration_status='registered' where camp_id in (select camp_id from club_camp_days where event_id=$1)",[f.id]);
    const latest=await expected(f.id);
    await asActor(coach,async()=>assert.deepEqual((await f.call({expected:latest})).rows[0].result.recipient_ids,[player]));
  });
}
