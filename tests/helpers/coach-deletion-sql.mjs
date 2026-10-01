import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export async function runDeletionSqlTests(t,db,ids,asActor) {
  const {clubA,clubB,coach,player,manager,revoked,groupA,groupB} = ids;
  const migration = readFileSync(new URL("../../supabase/migrations/20261006_coach_planning_deletion.sql",import.meta.url),"utf8");
  await db.exec(migration); await db.exec(migration);
  await db.exec(`create table training_sessions(id uuid primary key,club_event_id uuid references club_events(id));
    create table training_session_items(id uuid primary key,session_id uuid references training_sessions(id));
    grant all on training_sessions,training_session_items to service_role;`);
  let sequence = 12000;
  async function fixture({count=2,group=groupA,club=clubA,type='training'}={}) {
    const series = uuid(sequence++), events=[];
    await db.query('insert into club_event_series(id,group_id,club_id) values ($1,$2,$3)',[series,group,club]);
    for(let index=0;index<count;index++) {
      const event = uuid(sequence++); events.push(event);
      await db.query(`insert into club_events(id,group_id,club_id,series_id,event_type) values($1,$2,$3,$4,$5);
      `,[event,group,club,series,type]);
      await db.query('insert into club_event_attendees(event_id,player_id,status) values($1,$2,$3)',[event,player,index===0?'present':'absent']);
      await db.query("insert into club_event_structure_items(event_id,category,minutes) values($1,'putting',30)",[event]);
      await db.query('insert into message_threads(event_id,body) values($1,$2)',[event,'Conversation']);
      await db.query('insert into training_sessions(id,club_event_id) values($1,$1)',[event]);
      await db.query('insert into training_session_items(id,session_id) values($1,$1)',[event]);
    }
    return {series,events};
  }
  const call = ({actor=coach,event=null,series=null,confirmed=true}={}) => db.query(
    'select delete_coach_planning_v1($1,$2,$3,$4) result',[actor,event,series,confirmed]);
  const asService = run => asActor(coach,run,'service_role');
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'events',(select jsonb_agg(e order by id) from club_events e),'series',(select jsonb_agg(s order by id) from club_event_series s),
    'attendees',(select jsonb_agg(a order by event_id,player_id) from club_event_attendees a),
    'structure',(select jsonb_agg(i order by id) from club_event_structure_items i),
    'threads',(select jsonb_agg(t order by id) from message_threads t),
    'sessions',(select jsonb_agg(t order by id) from training_sessions t),
    'session_items',(select jsonb_agg(t order by id) from training_session_items t)) state`)).rows[0].state;
  await t.test('atomic deletion is service-only and rechecks actor, group, club and competition boundaries',async()=>{
    const local=await fixture(),foreign=await fixture({group:groupB,club:clubB}),competition=await fixture({type:'competition'});
    const before=await snapshot();
    await asActor(coach,()=>assert.rejects(call({series:local.series}),/permission denied/));
    await asActor(coach,()=>assert.rejects(call({series:local.series}),/permission denied/),'anon');
    await asService(async()=>{
      for(const actor of [revoked,player]) await assert.rejects(call({actor,series:local.series}),/forbidden/);
      await assert.rejects(call({series:foreign.series}),/forbidden/);
      await assert.rejects(call({series:competition.series}),/forbidden/);
      await assert.rejects(call({event:local.events[0],confirmed:false}),/occurrence_confirmation_required/);
      await assert.rejects(call({event:local.events[0],series:local.series}),/invalid_delete_scope/);
    }); assert.deepEqual(await snapshot(),before);
  });
  await t.test('occurrence deletion keeps the series and every other date, removing its dependencies together',async()=>{
    const local=await fixture();let result;
    await asService(async()=>{result=(await call({event:local.events[0]})).rows[0].result;});
    assert.equal(result.deleted_events,1);assert.deepEqual(result.recipient_ids,[player]);
    assert.deepEqual((await db.query('select id from club_events where series_id=$1',[local.series])).rows,[{id:local.events[1]}]);
    for(const table of ['club_event_attendees','club_event_structure_items','message_threads'])
      assert.equal((await db.query(`select count(*)::int n from ${table} where event_id=$1`,[local.events[0]])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from training_sessions where club_event_id=$1',[local.events[0]])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from training_session_items where id=$1',[local.events[0]])).rows[0].n,0);
  });
  await t.test('failure at the final series deletion rolls back events, participants, conversations and training logs',async()=>{
    const local=await fixture();const before=await snapshot();
    await db.exec(`create function fail_deletion_test() returns trigger language plpgsql as $$ begin raise exception 'injected_delete_failure'; end $$;
      create trigger fail_deletion_test before delete on club_event_series for each row execute function fail_deletion_test();`);
    await asService(()=>assert.rejects(call({series:local.series}),/injected_delete_failure/));
    assert.deepEqual(await snapshot(),before);
    await db.exec('drop trigger fail_deletion_test on club_event_series');
  });
  await t.test('a mixed-club series is rejected in full and an authorized empty series remains removable',async()=>{
    const local=await fixture(),empty=await fixture({count:0});
    await db.query('update club_events set group_id=$1,club_id=$2 where id=$3',[groupB,clubB,local.events[1]]);
    const before=await snapshot();await asService(()=>assert.rejects(call({series:local.series}),/forbidden/));assert.deepEqual(await snapshot(),before);
    await asService(async()=>assert.equal((await call({actor:manager,series:empty.series})).rows[0].result.deleted_events,0));
    assert.equal((await db.query('select count(*)::int n from club_event_series where id=$1',[empty.series])).rows[0].n,0);
  });
  await t.test('deletion does not silently truncate a series at the API row limit',async()=>{
    const local=await fixture({count:0});
    await db.query(`insert into club_events(id,group_id,club_id,series_id) select gen_random_uuid(),$1,$2,$3 from generate_series(1,1005)`,[groupA,clubA,local.series]);
    await asService(async()=>assert.equal((await call({series:local.series})).rows[0].result.deleted_events,1005));
    assert.equal((await db.query('select count(*)::int n from club_events where series_id=$1',[local.series])).rows[0].n,0);
  });
}
