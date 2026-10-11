import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPlayerCalendar } from '../lib/playerCalendarRead.ts';

test('one calendar response replaces context and item reads, without retaining results', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    return Response.json({ sessions: [], completedSessionIds: ['done'] });
  };
  const args = { token: 'fixture-credential', explicitChildId: 'junior', fetcher };
  const [first, second] = await Promise.all([loadPlayerCalendar(args), loadPlayerCalendar(args)]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.completedSessionIds, ['done']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/player/trainings?child_id=junior');
  assert.equal(calls[0][1].cache, 'no-store');
  await loadPlayerCalendar(args);
  assert.equal(calls.length, 2, 'authorization is rechecked after each completed read');
});

test('credentials and explicit children isolate concurrent reads', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}); };
  await Promise.all([
    loadPlayerCalendar({ token: 'one', explicitChildId: 'A', fetcher }),
    loadPlayerCalendar({ token: 'one', explicitChildId: 'B', fetcher }),
    loadPlayerCalendar({ token: 'two', explicitChildId: 'A', fetcher }),
  ]);
  assert.equal(calls, 3);
  await assert.rejects(loadPlayerCalendar({ token: '', fetcher }), /Invalid session/);
  assert.equal(calls, 3);
});

test('only a forbidden stored child is retried; an explicit forbidden selection remains an error', async () => {
  const urls = []; let forgotten = false;
  const fetcher = async url => {
    urls.push(url);
    return url.includes('?') ? Response.json({ error: 'Forbidden' }, { status: 403 }) : Response.json({ effectiveUserId: 'permitted' });
  };
  const result = await loadPlayerCalendar({ token: 'parent', storedChildId: 'revoked', fetcher, forgetStoredChild: () => { forgotten = true; } });
  assert.equal(result.effectiveUserId, 'permitted');
  assert.equal(forgotten, true);
  assert.deepEqual(urls, ['/api/player/trainings?child_id=revoked', '/api/player/trainings']);
  urls.length = 0;
  await assert.rejects(loadPlayerCalendar({ token: 'parent', explicitChildId: 'forbidden', storedChildId: 'permitted', fetcher }), /Forbidden/);
  assert.equal(urls.length, 1);
});
