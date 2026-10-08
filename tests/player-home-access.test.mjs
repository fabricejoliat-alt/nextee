import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import pg from 'pg';

const statePath = process.env.ACTIVITEE_ORG_FIXTURE_STATE;
if (!statePath) throw new Error('Provide the disposable localhost organization fixture state');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const app = process.env.ACTIVITEE_ORG_APP_URL ?? 'http://127.0.0.1:3011';
const rest = process.env.ACTIVITEE_ORG_REST_URL ?? 'http://127.0.0.1:4008/rest/v1';
for (const url of [app, rest]) if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local disposable fixtures only');
async function request(path, actor, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(path, { method, redirect: 'manual', headers: {
    Authorization: `Bearer ${state.tokens[actor] ?? state.keys[actor] ?? actor}`, apikey: state.keys.anon,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const period = new URLSearchParams({ from: monthStart.toISOString(), to: monthEnd.toISOString(), previous_from: previous.toISOString() });

test('home bootstrap exposes only authorized organizations and refuses a forged child', async () => {
  const own = await request(`${app}/api/player/context?home=1`, 'player');
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.home.profile.id, state.users.player.id);
  assert.deepEqual(own.data.home.organizations.map(row => row.id), [state.organizations.Sion]);
  const foreign = await request(`${app}/api/player/context?home=1&child_id=${state.users.externalPlayer.id}`, 'parent');
  assert.equal(foreign.status, 403);
});

test('Player and authorized Parent see the same personal monthly history; unrelated actors cannot read it', async () => {
  const id = crypto.randomUUID();
  const clubId = crypto.randomUUID(), blockedId = crypto.randomUUID();
  const created = await request(`${rest}/training_sessions`, 'service', [
    { id, club_id: null }, { id: clubId, club_id: state.organizations.Sion }, { id: blockedId, club_id: state.organizations.Centre },
  ].map(row => ({ ...row, user_id: state.users.player.id,
    start_at: now.toISOString(), session_type: 'individual', total_minutes: 60, notes: 'Isolated home optimization fixture' })));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  try {
    for (const actor of ['player', 'parent']) {
      const result = await request(`${app}/api/player/home-summary?${period}&child_id=${state.users.player.id}`, actor);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.ok(result.data.monthSessions.some(session => session.id === id));
      assert.ok(result.data.monthSessions.some(session => session.id === clubId));
      assert.ok(!result.data.monthSessions.some(session => session.id === blockedId));
      assert.ok(result.data.volumeConfigs.every(row => row.organizationId === state.organizations.Sion));
    }
    const foreign = await request(`${app}/api/player/home-summary?${period}&child_id=${state.users.player.id}`, 'outsider');
    assert.equal(foreign.status, 403);
    const invalid = await request(`${app}/api/player/home-summary?${period}`, 'invalid-token');
    assert.equal(invalid.status, 401);
  } finally {
    assert.equal((await request(`${rest}/training_sessions?id=in.(${id},${clubId},${blockedId})`, 'service', undefined, 'DELETE')).status, 200);
  }
});

test('pending academy remains blocked for both Player and Parent even with known history IDs', async () => {
  for (const actor of ['player', 'parent']) {
    const result = await request(`${app}/api/player/home-summary?${period}&organization_id=${state.organizations.Centre}&child_id=${state.users.player.id}`, actor);
    assert.equal(result.status, 403, JSON.stringify(result.data));
  }
});

test('a guardian scope revoked after an allowed read is enforced on the very next request', async () => {
  const scope = `${rest}/player_guardian_scopes?organization_id=eq.${state.organizations.Sion}&guardian_user_id=eq.${state.users.parent.id}&player_id=eq.${state.users.player.id}`;
  const before = await request(scope, 'service');
  assert.equal(before.status, 200); assert.equal(before.data.length, 1);
  const allowed = await request(`${app}/api/player/home-summary?${period}&child_id=${state.users.player.id}`, 'parent');
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  // Use a named fictitious audit actor; the fixture's service JWT has no profile.
  const database = new pg.Client({ host: '127.0.0.1', port: 55439, user: 'postgres', database: 'org_fixture' });
  await database.connect();
  async function permissions(view, edit) {
    await database.query('BEGIN');
    try {
      await database.query("select set_config('request.jwt.claim.role','service_role',true),set_config('activitee.actor_id',$1,true)", [state.users.sionManager.id]);
      const changed = await database.query('update public.player_guardian_scopes set can_view=$1,can_edit=$2 where organization_id=$3 and guardian_user_id=$4 and player_id=$5',
        [view, edit, state.organizations.Sion, state.users.parent.id, state.users.player.id]);
      assert.equal(changed.rowCount, 1);
      await database.query('COMMIT');
    } catch (error) { await database.query('ROLLBACK'); throw error; }
  }
  try {
    await permissions(false, false);
    const revoked = await request(`${app}/api/player/home-summary?${period}&child_id=${state.users.player.id}`, 'parent');
    assert.equal(revoked.status, 403, JSON.stringify(revoked.data));
  } finally {
    try { await permissions(before.data[0].can_view, before.data[0].can_edit); }
    finally { await database.end(); }
  }
});
