import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDeleteIndividualTraining, deleteIndividualTraining } from '../lib/playerTrainingActions.ts';

const individual = { id: 'session', user_id: 'player', session_type: 'individual', club_event_id: null };
function database(results) {
  const calls = [];
  const db = { from(table) {
    const result = results.shift();
    const chain = { then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
    for (const method of ['select', 'eq', 'is', 'delete', 'limit', 'maybeSingle']) {
      chain[method] = (...args) => { calls.push([table, method, ...args]); return chain; };
    }
    return chain;
  } };
  return { db, calls };
}

test('only an editable owned individual session outside club events and camps is deletable', () => {
  assert.equal(canDeleteIndividualTraining(individual, 'player', true, false), true);
  for (const [session, player, edit, camp] of [
    [null, 'player', true, false], [individual, 'other', true, false],
    [individual, 'player', false, false], [individual, 'player', true, true],
    [{ ...individual, session_type: 'club' }, 'player', true, false],
    [{ ...individual, club_event_id: 'event' }, 'player', true, false],
  ]) assert.equal(canDeleteIndividualTraining(session, player, edit, camp), false);
});

test('deletion rechecks identity and rejects a linked camp before issuing any mutation', async () => {
  for (const row of [null, { ...individual, user_id: 'other' }, { ...individual, club_event_id: 'event' }]) {
    const { db, calls } = database([{ data: row, error: null }]);
    await assert.rejects(deleteIndividualTraining(db, 'session', 'player'), /FORBIDDEN/);
    assert.ok(!calls.some(call => call[1] === 'delete'));
  }
  const { db, calls } = database([{ data: individual }, { data: [{ session_id: 'session' }] }]);
  await assert.rejects(deleteIndividualTraining(db, 'session', 'player'), /FORBIDDEN/);
  assert.ok(!calls.some(call => call[1] === 'delete'));
});

test('deletion guards ownership and session type in the mutation and requires a returned row', async () => {
  for (const deleted of [{ data: { id: 'session' } }, { data: null }, { error: new Error('RLS denied') }]) {
    const { db, calls } = database([{ data: individual }, { data: [] }, deleted]);
    const operation = deleteIndividualTraining(db, 'session', 'player');
    if (deleted.data) await operation;
    else await assert.rejects(operation, deleted.error ? /RLS denied/ : /NOT_CONFIRMED/);
    const mutation = calls.slice(calls.findIndex(call => call[1] === 'delete'));
    assert.deepEqual(mutation.slice(0, 5), [
      ['training_sessions', 'delete'], ['training_sessions', 'eq', 'id', 'session'],
      ['training_sessions', 'eq', 'user_id', 'player'], ['training_sessions', 'eq', 'session_type', 'individual'],
      ['training_sessions', 'is', 'club_event_id', null],
    ]);
  }
});

test('server-only camp lookup must succeed and exclude camp days before a browser deletion', async () => {
  for (const check of [async () => true, async () => { throw new Error('Forbidden'); }]) {
    const { db, calls } = database([{ data: individual }]);
    await assert.rejects(deleteIndividualTraining(db, 'session', 'player', check));
    assert.ok(!calls.some(call => call[1] === 'delete'));
  }
  const { db, calls } = database([{ data: individual }, { data: { id: 'session' } }]);
  await deleteIndividualTraining(db, 'session', 'player', async () => false);
  assert.ok(!calls.some(call => call[0] === 'player_camp_days'));
});
