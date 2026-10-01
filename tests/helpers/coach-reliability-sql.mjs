import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export async function prepareReliabilitySchema(db) {
  await db.exec(`
    create table public.clubs(id uuid primary key);
    create table auth.users(id uuid primary key);
    insert into clubs select distinct club_id from club_members;
    insert into auth.users select distinct user_id from club_members;
    create function public.is_org_manager_member(uuid,uuid) returns boolean language sql stable as $$
      select exists(select 1 from club_members where club_id = $1 and user_id = $2 and role = 'manager' and is_active) $$;
    alter table club_events add column title text, add column location_text text, add column coach_note text,
      add column series_id uuid, add column created_by uuid, add column requires_evaluation boolean default true;
    alter table club_events alter column id set default gen_random_uuid();
    alter table club_event_series add primary key(id);
    alter table club_event_series add column event_type text, add column title text, add column location_text text,
      add column coach_note text, add column weekday int, add column time_of_day time, add column interval_weeks int,
      add column start_date date, add column end_date date, add column duration_minutes int, add column is_active boolean,
      add column created_by uuid;
    alter table club_event_coaches add unique(event_id,coach_id);
    create table club_event_structure_items(id uuid primary key default gen_random_uuid(), event_id uuid references club_events(id),
      category text, minutes int check(minutes > 0 and minutes <= 300), note text, position int);
    create table message_threads(id uuid primary key default gen_random_uuid(), event_id uuid references club_events(id), body text);
    create table club_camps(id uuid primary key, club_id uuid, title text);
    create table club_camp_players(camp_id uuid references club_camps(id), player_id uuid, registration_status text,
      registered_at timestamptz, created_at timestamptz default now(), primary key(camp_id,player_id));
    create table club_camp_days(id uuid primary key default gen_random_uuid(), camp_id uuid references club_camps(id),
      event_id uuid references club_events(id), day_index int, unique(camp_id,day_index));
  `);
  // Use the actual criterion snapshot/response constraints and triggers.
  await db.exec(sql("20260910_add_custom_evaluation_criteria.sql"));
  await db.exec("grant all on all tables in schema public to service_role");
}

export async function runReliabilitySqlTests(t, db, ids, asActor) {
  const { clubA, coach, player, other, revoked, groupA, eventA } = ids;
  const migration = sql("20261003_coach_reliability_batch2.sql");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`update club_events set status='scheduled', starts_at=now()-interval '2 hours', ends_at=now()-interval '1 hour';
    insert into club_evaluation_criteria(id,club_id,name,respondent,response_format,choices_json,activity_types,domain_key,domain_label,is_required)
      values('${uuid(60)}','${clubA}','Required choice','both','yes_no','[{"value":true},{"value":false}]',array['training'],'mental','Mental',true);
    insert into club_event_evaluation_criteria(id,club_id,event_id,criterion_id,position)
      values('${uuid(61)}','${clubA}','${eventA}','${uuid(60)}',1);
    insert into club_event_evaluation_responses(club_id,event_id,event_criterion_id,player_id,respondent_user_id,respondent_role,value_json)
      values('${clubA}','${eventA}','${uuid(61)}','${player}','${player}','player','true');
  `);
  const stamp = async () => (await db.query("select coach_recorded_at::text stamp from club_event_attendees where event_id=$1 and player_id=$2",[eventA,player])).rows[0].stamp;
  const save = async (answers, expected, status="present") => db.query(
    "select save_coach_training_player_evaluation_v2($1,$2,$3,$4,4,4,4,$5,$6,true,$7,$8::jsonb) result",
    [eventA,coach,player,status,status === "present" ? "new-shared" : "",status === "present" ? "new-private" : "",expected,JSON.stringify(answers)]);
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'attendees',(select jsonb_agg(a) from club_event_attendees a),
    'feedback',(select jsonb_agg(f) from club_event_coach_feedback f),
    'responses',(select jsonb_agg(r) from club_event_evaluation_responses r),
    'debrief',(select jsonb_agg(d) from coach_training_debriefs d)) state`)).rows[0].state;

  await t.test("guided v2 rejects missing, invalid and foreign custom criteria without mutation", async () => {
    const before = await snapshot();
    await asActor(coach, async () => {
      for (const [answers,error] of [[{},/required_criteria_missing/],[{[uuid(61)]:"false"},/invalid_custom_response/],[{[uuid(99)]:true},/invalid_custom_criterion/]]) {
        await assert.rejects(save(answers, await stamp()),error);
      }
    },"service_role");
    assert.deepEqual(await snapshot(),before);
  });
  await t.test("guided v2 saves feedback, attendance, custom answers and retains player answers", async () => {
    await asActor(coach,async () => {
      const result = await save({[uuid(61)]:false},await stamp());
      assert.ok(result.rows[0].result.recorded_at);
      assert.deepEqual((await db.query("select respondent_role,value_json from club_event_evaluation_responses order by respondent_role")).rows,
        [{respondent_role:"coach",value_json:false},{respondent_role:"player",value_json:true}]);
      assert.equal((await db.query("select private_note from club_event_coach_feedback")).rows[0].private_note,"new-private");
    },"service_role");
  });
  await t.test("a stale Coach form cannot overwrite a colleague's saved evaluation", async () => {
    const before = await snapshot();
    await asActor(coach,async () => assert.rejects(save({[uuid(61)]:true},null),/evaluation_conflict/),"service_role");
    assert.deepEqual(await snapshot(),before);
  });
  await t.test("failure after feedback save rolls back attendance, notes and custom answers together", async () => {
    await db.exec(`create function fail_answer_test() returns trigger language plpgsql as $$ begin raise exception 'injected_answer_failure'; end $$;
      create trigger fail_answer before insert on club_event_evaluation_responses for each row execute function fail_answer_test();`);
    const before = await snapshot();
    await asActor(coach,async () => assert.rejects(save({[uuid(61)]:true},await stamp()),/injected_answer_failure/),"service_role");
    assert.deepEqual(await snapshot(),before);
    await db.exec("drop trigger fail_answer on club_event_evaluation_responses");
  });
  await t.test("explicit absence removes stale Coach comments/answers but retains the player's own answer", async () => {
    await asActor(coach,async () => { await save({},await stamp(),"absent"); },"service_role");
    assert.equal((await db.query("select count(*)::int n from club_event_coach_feedback")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int n from club_event_evaluation_responses where respondent_role='coach'")).rows[0].n,0);
    assert.equal((await db.query("select individual_comments from coach_training_debriefs")).rows[0].individual_comments[player],undefined);
    assert.equal((await db.query("select count(*)::int n from club_event_evaluation_responses where respondent_role='player'")).rows[0].n,1);
  });

  const camp = uuid(70), day2 = uuid(71);
  await db.exec(`insert into club_camps values('${camp}','${clubA}','Fixture camp');
    insert into club_camp_players(camp_id,player_id,registration_status,registered_at) values('${camp}','${player}','registered','2020-01-01');
    insert into club_events(id,group_id,club_id,event_type) values('${day2}','${groupA}','${clubA}','camp');
    insert into club_camp_days(camp_id,event_id,day_index) values('${camp}','${eventA}',0),('${camp}','${day2}',1);
    insert into club_event_attendees(event_id,player_id,status,coach_recorded_status,coach_recorded_by,coach_recorded_at)
      values('${day2}','${player}','absent','absent','${coach}','2020-01-02');`);
  const campSnapshot = async () => (await db.query(`select jsonb_build_object('players',(select jsonb_agg(p) from club_camp_players p),
    'attendees',(select jsonb_agg(a order by event_id) from club_event_attendees a)) state`)).rows[0].state;
  const patchCamp = (rows,actor=coach) => db.query("select patch_coach_camp_registrations_v1($1,$2,$3::jsonb)",[camp,actor,JSON.stringify(rows)]);
  await t.test("an empty camp patch does not rewrite any existing presence or metadata", async () => {
    const before = await campSnapshot();
    await asActor(coach,() => patchCamp([]),"service_role");
    assert.deepEqual(await campSnapshot(),before);
  });
  await t.test("a one-day camp patch preserves other days, registration date and recorded author", async () => {
    const before = await campSnapshot();
    await asActor(coach,() => patchCamp([{player_id:player,day_status_by_day_index:{"0":"present"}}]),"service_role");
    const after = await campSnapshot();
    assert.deepEqual(after.players,before.players);
    assert.deepEqual(after.attendees.find(a=>a.event_id===day2),before.attendees.find(a=>a.event_id===day2));
    assert.equal(after.attendees.find(a=>a.event_id===eventA).coach_recorded_status,"present");
  });
  await t.test("a bad second camp record rolls back the first record's changes", async () => {
    const before = await campSnapshot();
    await asActor(coach,async () => {
      await assert.rejects(patchCamp([{player_id:player,registration_status:"declined"},{player_id:other,registration_status:"registered"}]),/invalid_player/);
      await assert.rejects(patchCamp([{player_id:player,day_status_by_day_index:{"99":"absent"}}]),/invalid_day_status/);
      await assert.rejects(patchCamp([],revoked),/forbidden/);
    },"service_role");
    assert.deepEqual(await campSnapshot(),before);
  });
  await t.test("browser cannot call a service-role-only camp or evaluation RPC", async () => {
    await asActor(coach,async () => {
      await assert.rejects(patchCamp([]),/permission denied/);
      await assert.rejects(save({},null),/permission denied/);
    });
  });

  const series = uuid(80), first = uuid(81), second = uuid(82), past = uuid(83);
  const template = {event_type:"training",title:"Recurring fixture",start_date:"2090-03-19",end_date:"2090-03-26",
    weekday:new Date("2090-03-19T12:00:00Z").getUTCDay(),time_of_day:"10:00",interval_weeks:1,duration_minutes:60,is_active:true};
  await db.query(`insert into club_event_series(id,group_id,club_id,event_type,title,weekday,time_of_day,interval_weeks,start_date,end_date,duration_minutes,is_active)
    values($1,$2,$3,'training','Old fixture',$4,'10:00',1,'2090-03-19','2090-03-26',60,true)`,[series,groupA,clubA,template.weekday]);
  await db.exec(`insert into club_events(id,group_id,club_id,series_id,starts_at,ends_at) values
    ('${first}','${groupA}','${clubA}','${series}','2090-03-19 10:00 Europe/Zurich','2090-03-19 11:00 Europe/Zurich'),
    ('${second}','${groupA}','${clubA}','${series}','2090-03-26 10:00 Europe/Zurich','2090-03-26 11:00 Europe/Zurich'),
    ('${past}','${groupA}','${clubA}','${series}','2020-03-19 10:00 Europe/Zurich','2020-03-19 11:00 Europe/Zurich');
    insert into club_event_attendees(event_id,player_id,status,coach_recorded_status,coach_recorded_by,coach_recorded_at)
      values('${first}','${player}','absent','absent','${coach}','2020-01-02');
    insert into message_threads(event_id,body) values('${first}','keep discussion');
    insert into club_event_structure_items(event_id,category,minutes,note,position) values('${first}','putting',30,'keep until commit',0);`);
  const updateSeries = (changes={},players=[player],structure=[{category:"putting",minutes:30}]) => db.query(
    "select update_coach_event_series_v1($1,$2::jsonb,$3::uuid[],$4::uuid[],$5::jsonb) result",
    [first,JSON.stringify({...template,...changes}),[coach],players,JSON.stringify(structure)]);
  const seriesSnapshot = async () => (await db.query(`select jsonb_build_object('series',(select to_jsonb(s) from club_event_series s where id='${series}'),
    'events',(select jsonb_agg(e order by id) from club_events e where series_id='${series}'),
    'attendees',(select jsonb_agg(a order by event_id) from club_event_attendees a),
    'threads',(select jsonb_agg(m) from message_threads m),'structure',(select jsonb_agg(i order by id) from club_event_structure_items i)) state`)).rows[0].state;
  await t.test("recurrence permission, empty plan and invalid assignments fail without any mutation", async () => {
    const before = await seriesSnapshot();
    await asActor(revoked,async () => assert.rejects(updateSeries(),/forbidden/));
    await asActor(coach,async () => {
      await assert.rejects(updateSeries({start_date:"2020-01-01",end_date:"2020-02-01"}),/no_future_occurrence/);
      await assert.rejects(updateSeries({},[other]),/invalid_assignments/);
      await assert.rejects(updateSeries({},[player],[{category:"putting",minutes:301}]),/invalid_structure/);
      await assert.rejects(updateSeries({end_date:"2092-03-26"}),/too_many_occurrences/);
    });
    assert.deepEqual(await seriesSnapshot(),before);
  });
  await t.test("recurrence save retains event IDs, discussions, absence and past occurrences", async () => {
    const before = await seriesSnapshot();
    await asActor(coach,() => updateSeries({time_of_day:"11:00"}));
    const after = await seriesSnapshot();
    assert.deepEqual(after.events.map(e=>e.id),before.events.map(e=>e.id));
    assert.deepEqual(after.events.find(e=>e.id===past),before.events.find(e=>e.id===past));
    assert.deepEqual(after.attendees.find(a=>a.event_id===first),before.attendees.find(a=>a.event_id===first));
    assert.deepEqual(after.threads,before.threads);
  });
  await t.test("late recurrence failure rolls back the template, dates, assignments and structure", async () => {
    await db.exec(`create function fail_structure_test() returns trigger language plpgsql as $$ begin raise exception 'injected_structure_failure'; end $$;
      create trigger fail_structure before insert on club_event_structure_items for each row execute function fail_structure_test();`);
    const before = await seriesSnapshot();
    await asActor(coach,async () => assert.rejects(updateSeries({time_of_day:"12:00"}),/injected_structure_failure/));
    assert.deepEqual(await seriesSnapshot(),before);
    await db.exec("drop trigger fail_structure on club_event_structure_items");
  });
  await t.test("removing a future evaluated participant is rejected atomically", async () => {
    const before = await seriesSnapshot();
    await asActor(coach,async () => assert.rejects(updateSeries({},[]),/evaluated_attendee_removal/));
    assert.deepEqual(await seriesSnapshot(),before);
  });
  await t.test("shortening a recurrence cancels surplus occurrences without deleting their discussions", async () => {
    await asActor(coach,() => updateSeries({end_date:"2090-03-19"}));
    assert.equal((await db.query("select status from club_events where id=$1",[second])).rows[0].status,"cancelled");
    assert.equal((await db.query("select count(*)::int n from message_threads")).rows[0].n,1);
    await asActor(coach,() => updateSeries({is_active:false}));
    assert.equal((await db.query("select status from club_events where id=$1",[first])).rows[0].status,"cancelled");
    assert.equal((await db.query("select count(*)::int n from message_threads")).rows[0].n,1);
  });
  await t.test("new occurrences inherit custom criteria and keep Zurich wall time across daylight saving", async () => {
    await db.exec(`insert into club_event_evaluation_criteria(club_id,event_id,criterion_id,position)
      values('${clubA}','${first}','${uuid(60)}',1)`);
    await asActor(coach,() => updateSeries({end_date:"2090-04-02"}));
    const events = (await db.query("select id, (starts_at at time zone 'Europe/Zurich')::time::text wall_time from club_events where series_id=$1 and starts_at>now() and status='scheduled'",[series])).rows;
    assert.equal(events.length,3);
    assert.ok(events.every(e=>e.wall_time==='10:00:00'));
    for (const event of events) {
      assert.equal((await db.query("select snapshot_is_required from club_event_evaluation_criteria where event_id=$1",[event.id])).rows[0].snapshot_is_required,true);
      assert.equal((await db.query("select count(*)::int n from club_event_attendees where event_id=$1",[event.id])).rows[0].n,1);
    }
  });
}
