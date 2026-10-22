import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('saved self-evaluations protect attendance in PostgreSQL across all write paths', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create table club_events(id uuid primary key, event_type text);
    create table club_event_attendees(event_id uuid, player_id uuid, status text, coach_recorded_status text,
      coach_recorded_at timestamptz, primary key(event_id,player_id));
    create table training_sessions(id int primary key, club_event_id uuid, user_id uuid, motivation int, difficulty int, satisfaction int);
    create table club_event_player_feedback(event_id uuid, player_id uuid, motivation int, difficulty int, satisfaction int);
    create table club_event_evaluation_responses(event_id uuid, player_id uuid, respondent_role text, value_json jsonb);
    grant select, insert, update on all tables in schema public to authenticated;
  `);
  const migration = readFileSync(new URL('../supabase/migrations/20261022_lock_evaluated_training_attendance.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration);
  const event = '00000000-0000-4000-8000-000000000001';
  const player = '00000000-0000-4000-8000-000000000002';
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const reset = async () => {
    await db.exec('truncate training_sessions,club_event_player_feedback,club_event_evaluation_responses,club_event_attendees,club_events');
    await query("insert into club_events values($1,'training')", [event]);
    await query("insert into club_event_attendees values($1,$2,'present','present',null)", [event,player]);
  };
  const presence = async () => (await query('select status,coach_recorded_status from club_event_attendees'))[0];
  await t.test('direct attendance updates and guided saves cannot invalidate a submitted self-evaluation', async () => {
    await reset(); await query('insert into training_sessions values(1,$1,$2,5,4,6)', [event,player]);
    await db.exec('set role authenticated');
    for (const patch of ["status='absent'", "coach_recorded_status='absent'", "status='absent',coach_recorded_status='absent'", "coach_recorded_status=null"]) {
      await assert.rejects(db.exec(`update club_event_attendees set ${patch}`), /attendance_locked_by_player_evaluation/);
    }
    assert.deepEqual(await presence(), { status:'present',coach_recorded_status:'present' });
    await db.exec("update club_event_attendees set status='present',coach_recorded_status='present',coach_recorded_at=now()");
    await db.exec('update training_sessions set motivation=6');
    assert.equal((await query('select motivation from training_sessions'))[0].motivation,6);
    await assert.rejects(query('select training_player_has_evaluation($1,$2)',[event,player]),/permission denied/);
    await db.exec('reset role');
  });
  await t.test('legacy feedback and boolean/zero custom responses protect attendance, not coach-only answers', async () => {
    for (const value of ['false','0','"answer"']) {
      await reset(); await query("insert into club_event_evaluation_responses values($1,$2,'player',$3)",[event,player,value]);
      await assert.rejects(db.exec("update club_event_attendees set status='absent'"),/attendance_locked_by_player_evaluation/);
    }
    await reset(); await query('insert into club_event_player_feedback values($1,$2,4,null,null)',[event,player]);
    await assert.rejects(db.exec("update club_event_attendees set status='absent'"),/attendance_locked_by_player_evaluation/);
    await reset(); await query("insert into club_event_evaluation_responses values($1,$2,'coach','true')",[event,player]);
    await db.exec("update club_event_attendees set status='absent',coach_recorded_status='absent'");
    assert.equal((await presence()).status,'absent');
  });
  await t.test('an expected evaluated player can be confirmed present without unlocking absence', async () => {
    await reset(); await db.exec("update club_event_attendees set status='expected',coach_recorded_status=null");
    await query('insert into training_sessions values(1,$1,$2,4,4,4)',[event,player]);
    await db.exec("update club_event_attendees set status='present',coach_recorded_status='present'");
    await assert.rejects(db.exec("update club_event_attendees set status='absent',coach_recorded_status='absent'"),/attendance_locked_by_player_evaluation/);
  });
  await t.test('an empty session does not lock attendance; a stale player save after absence is rejected', async () => {
    await reset(); await query('insert into training_sessions values(1,$1,$2,null,null,null)',[event,player]);
    await db.exec("update club_event_attendees set status='absent',coach_recorded_status='absent'");
    await assert.rejects(db.exec('update training_sessions set motivation=4,difficulty=4,satisfaction=4'),/player_evaluation_attendance_absent/);
    await assert.rejects(query('insert into club_event_player_feedback values($1,$2,4,4,4)',[event,player]),/player_evaluation_attendance_absent/);
    await assert.rejects(query("insert into club_event_evaluation_responses values($1,$2,'player','false')",[event,player]),/player_evaluation_attendance_absent/);
    assert.equal((await query('select motivation from training_sessions'))[0].motivation,null);
  });
  await t.test('personal sessions and other event types retain their existing behavior', async () => {
    await reset(); await db.exec("update club_events set event_type='camp'");
    await query('insert into training_sessions values(1,$1,$2,4,4,4)',[event,player]);
    await db.exec("update club_event_attendees set status='absent',coach_recorded_status='absent'");
    await query('insert into training_sessions values(2,null,$1,4,4,4)',[player]);
    assert.equal((await query('select count(*)::int as n from training_sessions'))[0].n,2);
  });
});
