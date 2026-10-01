import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export async function runCreationSqlTests(t,db,ids,asActor){
  const {clubA,clubB,coach,player,manager,revoked,groupA,groupB}=ids;
  await db.exec("alter table club_event_series alter column id set default gen_random_uuid()");
  const migration=readFileSync(new URL("../../supabase/migrations/20261005_coach_event_creation.sql",import.meta.url),"utf8");
  await db.exec(migration);await db.exec(migration);
  let sequence=1000;
  const single={event_type:'training',title:null,starts_at:'2090-03-19T09:00:00Z',ends_at:'2090-03-19T10:00:00Z',duration_minutes:60};
  const recurring={event_type:'training',title:null,start_date:'2090-03-19',end_date:'2090-04-02',weekday:0,time_of_day:'10:00',interval_weeks:1,duration_minutes:60};
  recurring.weekday=new Date('2090-03-19T12:00:00Z').getUTCDay();
  const call=(opts={})=>db.query("select create_coach_events_v1($1,$2,$3,$4::jsonb,$5::uuid[],$6::uuid[],$7::jsonb) result",[
    opts.request??uuid(sequence++),opts.group??groupA,opts.mode??'single',JSON.stringify(opts.template??single),
    opts.coaches??[coach],opts.players??[player],JSON.stringify(opts.structure??[{category:'putting',minutes:30,note:'Station'}])]);
  const state=async()=> (await db.query(`select jsonb_build_object(
    'events',(select jsonb_agg(e order by id) from club_events e),'series',(select jsonb_agg(s order by id) from club_event_series s),
    'requests',(select jsonb_agg(r order by request_id) from coach_event_creation_requests r),
    'coaches',(select jsonb_agg(c order by event_id,coach_id) from club_event_coaches c),
    'attendees',(select jsonb_agg(a order by event_id,player_id) from club_event_attendees a),
    'structure',(select jsonb_agg(i order by id) from club_event_structure_items i)) state`)).rows[0].state;
  await t.test('creation checks active group planning permission and cannot assign foreign members',async()=>{
    const before=await state();
    for(const actor of [revoked,player,uuid(502)]) await asActor(actor,()=>assert.rejects(call(),/forbidden/));
    await asActor(coach,async()=>{
      await assert.rejects(call({group:groupB}),/forbidden/);
      await assert.rejects(call({coaches:[revoked]}),/invalid_assignments/);
      await assert.rejects(call({players:[uuid(501)]}),/invalid_assignments/);
    });
    assert.deepEqual(await state(),before);
  });
  await t.test('creation saves the complete event and never fabricates a recorded attendance',async()=>{
    let result;await asActor(coach,async()=>{result=(await call({coaches:[coach,coach],players:[player,player]})).rows[0].result;});
    assert.equal(result.ok,true);assert.equal(result.event_ids.length,1);
    const id=result.event_ids[0];
    assert.deepEqual((await db.query('select group_id,club_id,created_by from club_events where id=$1',[id])).rows,[{group_id:groupA,club_id:clubA,created_by:coach}]);
    assert.deepEqual((await db.query('select status,coach_recorded_status,coach_recorded_at from club_event_attendees where event_id=$1',[id])).rows,
      [{status:'present',coach_recorded_status:null,coach_recorded_at:null}]);
    assert.equal((await db.query('select count(*)::int n from club_event_coaches where event_id=$1',[id])).rows[0].n,1);
    assert.equal((await db.query('select note from club_event_structure_items where event_id=$1',[id])).rows[0].note,'Station');
  });
  await t.test('a repeated request returns the original IDs without duplicating a single event or series',async()=>{
    for(const mode of ['single','series']){
      const request=uuid(sequence++),template=mode==='single'?single:recurring;let first,second;
      await asActor(coach,async()=>{first=(await call({request,mode,template})).rows[0].result;});
      const before=await state();
      await asActor(coach,async()=>{second=(await call({request,mode,template})).rows[0].result;});
      assert.deepEqual(second,{...first,replayed:true});assert.deepEqual(await state(),before);
      await asActor(coach,()=>assert.rejects(call({request,mode,template:{...template,title:'Different draft'}}),/creation_request_conflict/));
      assert.deepEqual(await state(),before);
    }
  });
  await t.test('recurrence creates every selected day and preserves Zurich wall time across DST',async()=>{
    let result;await asActor(manager,async()=>{result=(await call({mode:'series',template:recurring})).rows[0].result;});
    const events=(await db.query("select (starts_at at time zone 'Europe/Zurich')::time::text local_time,ends_at-starts_at duration,created_by from club_events where series_id=$1",[result.series_id])).rows;
    assert.equal(events.length,3);assert.ok(events.every(e=>e.local_time==='10:00:00'&&e.created_by===manager));
    assert.equal((await db.query('select count(*)::int n from club_event_attendees where event_id=any($1::uuid[])',[result.event_ids])).rows[0].n,3);
  });
  await t.test('overlong, empty and invalid recurrences reject the whole plan instead of truncating it',async()=>{
    const before=await state();
    await asActor(coach,async()=>{
      await assert.rejects(call({mode:'series',template:{...recurring,end_date:'2092-04-02'}}),/too_many_occurrences/);
      await assert.rejects(call({mode:'series',template:{...recurring,end_date:recurring.start_date,weekday:(recurring.weekday+1)%7}}),/no_occurrence/);
      await assert.rejects(call({mode:'series',template:{...recurring,interval_weeks:0}}),/invalid_recurrence/);
    });assert.deepEqual(await state(),before);
  });
  await t.test('a failed late station insert rolls back the series, all dates, assignments and retry key',async()=>{
    await db.exec(`create function fail_creation_structure() returns trigger language plpgsql as $$ begin raise exception 'injected_creation_failure'; end $$;
      create trigger fail_creation_structure before insert on club_event_structure_items for each row execute function fail_creation_structure();`);
    const before=await state(),request=uuid(sequence++);
    await asActor(coach,()=>assert.rejects(call({request,mode:'series',template:recurring}),/injected_creation_failure/));
    assert.deepEqual(await state(),before);await db.exec('drop trigger fail_creation_structure on club_event_structure_items');
    await asActor(coach,async()=>assert.equal((await call({request,mode:'series',template:recurring})).rows[0].result.replayed,false));
  });
  await t.test('creation request records are private and retry still checks revoked permission',async()=>{
    const request=uuid(sequence++);await asActor(coach,()=>call({request}));
    await asActor(coach,()=>assert.rejects(db.query('select * from coach_event_creation_requests'),/permission denied/));
    await asActor(coach,()=>assert.rejects(call(),/permission denied/),'anon');
    await db.query('update club_members set can_manage_assigned_group_planning=false where club_id=$1 and user_id=$2',[clubA,coach]);
    await asActor(coach,()=>assert.rejects(call({request}),/forbidden/));
    await db.query('update club_members set can_manage_assigned_group_planning=true where club_id=$1 and user_id=$2',[clubA,coach]);
    assert.notEqual(clubA,clubB);
  });
}
