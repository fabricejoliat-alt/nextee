import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';

const statePath = process.env.ACTIVITEE_ORG_FIXTURE_STATE;
if (!statePath) throw new Error('Provide disposable localhost fixture state');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const app = process.env.ACTIVITEE_ORG_APP_URL ?? 'http://127.0.0.1:3011';
const rest = process.env.ACTIVITEE_ORG_REST_URL ?? 'http://127.0.0.1:4008/rest/v1';
for (const url of [app, rest]) if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Disposable localhost fixtures only');
async function request(path, actor, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(path, { method, redirect: 'manual', headers: {
    Authorization: `Bearer ${state.tokens[actor] ?? state.keys[actor] ?? actor}`, apikey: state.keys.anon,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
const endpoint = view => `${app}/api/player/golf-data?view=${view}&child_id=${state.users.player.id}`;

test('all golf views deny foreign children, invalid sessions and pending academy access', async () => {
  for (const view of ['rounds', 'dashboard', 'pending']) {
    assert.equal((await request(endpoint(view), 'invalid-token')).status, 401);
    assert.equal((await request(endpoint(view), 'outsider')).status, 403);
    assert.equal((await request(`${app}/api/player/golf-data?view=${view}&child_id=${state.users.externalPlayer.id}`, 'parent')).status, 403);
    for (const actor of ['player', 'parent']) {
      assert.equal((await request(`${endpoint(view)}&organization_id=${state.organizations.Centre}`, actor)).status, 403);
    }
  }
});

test('authorized Player and Parent receive their complete personal history and exclude other organizations', async () => {
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  const sessionIds = Array.from({ length: 3 }, () => crypto.randomUUID());
  const clubs = [null, state.organizations.Sion, state.organizations.Centre];
  const date = new Date(Date.now() - 86400000).toISOString();
  const rounds = ids.map((id, index) => ({ id, club_id: clubs[index], user_id: state.users.player.id, start_at: date, round_type: 'training', course_name: 'Local fixture course', score_entry_mode: 'full' }));
  const sessions = sessionIds.map((id, index) => ({ id, club_id: clubs[index], user_id: state.users.player.id, start_at: date, session_type: 'individual', total_minutes: 60 }));
  const holeIds = ids.map(() => crypto.randomUUID());
  const historyId = crypto.randomUUID();
  const database = new pg.Client({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'org_fixture' });
  await database.connect();
  await database.query("set request.jwt.claim.role='service_role'");
  await database.query('update public.club_members set is_performance=true where user_id=$1 and club_id=$2', [state.users.player.id, state.organizations.Sion]);
  try {
    assert.equal((await request(`${rest}/golf_rounds`, 'service', rounds)).status, 201);
    assert.equal((await request(`${rest}/golf_round_holes`, 'service', ids.map((round_id, index) => ({ id: holeIds[index], round_id, hole_no: 1, par: 4, score: 5 })))).status, 201);
    assert.equal((await request(`${rest}/training_sessions`, 'service', sessions)).status, 201);
    assert.equal((await request(`${rest}/player_handicap_history`, 'service', { id: historyId, user_id: state.users.player.id, effective_date: '2026-01-01', value: 21 })).status, 201);
    for (const actor of ['player', 'parent']) {
      for (const view of ['rounds', 'dashboard']) {
        const result = await request(endpoint(view), actor);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.match(result.headers.get('cache-control'), /no-store/);
        assert.ok(result.headers.get('server-timing'));
        assert.deepEqual(result.data.rounds.map(row => row.id).sort(), ids.slice(0, 2).sort());
        assert.deepEqual(result.data.holes.map(row => row.id).sort(), holeIds.slice(0, 2).sort());
        if (view === 'dashboard') {
          assert.deepEqual(result.data.sessions.map(row => row.id).sort(), sessionIds.slice(0, 2).sort());
          assert.deepEqual(result.data.handicapHistory.map(row => row.id), [historyId]);
          assert.deepEqual(result.data.pending.map(row => row.id).sort(), sessionIds.slice(0, 2).sort());
          assert.deepEqual(result.data.organizationIds, [state.organizations.Sion]);
        }
      }
      const pending = await request(endpoint('pending'), actor);
      assert.equal(pending.status, 200, JSON.stringify(pending.data));
      assert.deepEqual(pending.data.rows.map(row => row.id).sort(), sessionIds.slice(0, 2).sort());
      assert.ok(pending.data.rows.every(row => row.href === `/player/golf/trainings/${row.id}/edit`));
    }
  } finally {
    await request(`${rest}/golf_rounds?id=in.(${ids.join(',')})`, 'service', undefined, 'DELETE');
    await request(`${rest}/training_sessions?id=in.(${sessionIds.join(',')})`, 'service', undefined, 'DELETE');
    await request(`${rest}/player_handicap_history?id=eq.${historyId}`, 'service', undefined, 'DELETE');
    await database.end();
  }
});

test('guardian revocation is enforced on the next read in every golf view', async () => {
  const database = new pg.Client({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'org_fixture' });
  await database.connect();
  async function permissions(view) {
    await database.query('BEGIN');
    try {
      await database.query("select set_config('request.jwt.claim.role','service_role',true),set_config('activitee.actor_id',$1,true)", [state.users.sionManager.id]);
      await database.query('update public.player_guardian_scopes set can_view=$1,can_edit=$1 where organization_id=$2 and guardian_user_id=$3 and player_id=$4', [view, state.organizations.Sion, state.users.parent.id, state.users.player.id]);
      await database.query('COMMIT');
    } catch (error) { await database.query('ROLLBACK'); throw error; }
  }
  try {
    for (const view of ['rounds', 'dashboard', 'pending']) assert.equal((await request(endpoint(view), 'parent')).status, 200);
    await permissions(false);
    for (const view of ['rounds', 'dashboard', 'pending']) assert.equal((await request(endpoint(view), 'parent')).status, 403);
  } finally { try { await permissions(true); } finally { await database.end(); } }
});

test('pending evaluations exclude ongoing, excused, complete and cancelled camp days', async () => {
  const database = new pg.Client({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'org_fixture' });
  await database.connect();
  const events = Array.from({ length: 5 }, () => crypto.randomUUID());
  const camp = crypto.randomUUID(), session = crypto.randomUUID(), group = crypto.randomUUID();
  const start = new Date(Date.now() - 86400000).toISOString(), end = new Date(Date.now() - 82800000).toISOString();
  try {
    await database.query("set request.jwt.claim.role='service_role'");
    await database.query("insert into public.coach_groups(id,club_id,name) values($1,$2,'Local evaluation group')", [group, state.organizations.Sion]);
    for (let index = 0; index < events.length; index++) {
      await database.query("insert into public.club_events(id,club_id,event_type,title,starts_at,ends_at,requires_evaluation,status,group_id,created_by) values($1,$2,$3,'Local evaluation fixture',$4,$5,true,'scheduled',$6,$7)",
        [events[index], state.organizations.Sion, index === 4 ? 'camp' : 'training', start, index === 1 ? new Date(Date.now() + 86400000).toISOString() : end, group, state.users.sionManager.id]);
      await database.query('insert into public.club_event_attendees(event_id,player_id,status) values($1,$2,$3)', [events[index], state.users.player.id, index === 2 ? 'excused' : 'present']);
    }
    await database.query("insert into public.club_camps(id,club_id,title,status) values($1,$2,'Local cancelled camp','cancelled')", [camp, state.organizations.Sion]);
    await database.query('insert into public.club_camp_days(camp_id,event_id) values($1,$2)', [camp, events[4]]);
    await database.query("insert into public.training_sessions(id,user_id,club_id,club_event_id,start_at,session_type,motivation,difficulty,satisfaction) values($1,$2,$3,$4,$5,'club',4,4,4)", [session, state.users.player.id, state.organizations.Sion, events[3], start]);
    await database.query("insert into public.training_session_items(session_id,category,minutes) values($1,'putting',30)", [session]);
    for (const actor of ['player', 'parent']) {
      const pending = await request(endpoint('pending'), actor);
      assert.equal(pending.status, 200, JSON.stringify(pending.data));
      assert.deepEqual(pending.data.rows.map(row => row.id), [events[0]]);
      assert.deepEqual(Object.keys(pending.data.eventById), [events[0]]);
      assert.equal(pending.data.rows[0].href, `/player/golf/trainings/new?club_event_id=${events[0]}`);
      assert.equal(pending.data.clubNameById[state.organizations.Sion], 'Fixture Sion');
    }
  } finally {
    try {
      await database.query('delete from public.training_sessions where id=$1', [session]);
      await database.query('delete from public.club_camps where id=$1', [camp]);
      await database.query('delete from public.message_threads where event_id=any($1::uuid[]) or group_id=$2', [events, group]);
      await database.query('delete from public.club_events where id=any($1::uuid[])', [events]);
      await database.query('delete from public.coach_groups where id=$1', [group]);
    } finally { await database.end(); }
  }
});
