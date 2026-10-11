import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPlayerNews } from '../lib/playerNewsRead.ts';

test('one news response replaces context and item reads, without retaining results', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    return Response.json({ sessions: [], completedSessionIds: ['done'] });
  };
  const args = { locale: 'fr', token: 'fixture-credential', explicitChildId: 'junior', fetcher };
  const [first, second] = await Promise.all([loadPlayerNews(args), loadPlayerNews(args)]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.completedSessionIds, ['done']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/player/news?include_archived=1&locale=fr&child_id=junior');
  assert.equal(calls[0][1].cache, 'no-store');
  await loadPlayerNews(args);
  assert.equal(calls.length, 2, 'authorization is rechecked after each completed read');
});

test('credentials and explicit children isolate concurrent reads', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}); };
  await Promise.all([
    loadPlayerNews({ locale: 'fr', token: 'one', explicitChildId: 'A', fetcher }),
    loadPlayerNews({ locale: 'fr', token: 'one', explicitChildId: 'B', fetcher }),
    loadPlayerNews({ locale: 'fr', token: 'two', explicitChildId: 'A', fetcher }),
  ]);
  assert.equal(calls, 3);
  await assert.rejects(loadPlayerNews({ locale: 'fr', token: '', fetcher }), /Invalid session/);
  assert.equal(calls, 3);
});

test('only a forbidden stored child is retried; an explicit forbidden selection remains an error', async () => {
  const urls = []; let forgotten = false;
  const fetcher = async url => {
    urls.push(url);
    return url.includes('child_id=') ? Response.json({ error: 'Forbidden' }, { status: 403 }) : Response.json({ effectiveUserId: 'permitted' });
  };
  const result = await loadPlayerNews({ locale: 'fr', token: 'parent', storedChildId: 'revoked', fetcher, forgetStoredChild: () => { forgotten = true; } });
  assert.equal(result.effectiveUserId, 'permitted');
  assert.equal(forgotten, true);
  assert.deepEqual(urls, ['/api/player/news?include_archived=1&locale=fr&child_id=revoked', '/api/player/news?include_archived=1&locale=fr']);
  urls.length = 0;
  await assert.rejects(loadPlayerNews({ locale: 'fr', token: 'parent', explicitChildId: 'forbidden', storedChildId: 'permitted', fetcher }), /Forbidden/);
  assert.equal(urls.length, 1);
});

test('locale isolates concurrent news reads', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(url); return Response.json({ news: [] }); };
  await Promise.all(['fr', 'de'].map(locale => loadPlayerNews({ token: 'reader', locale, fetcher })));
  assert.equal(urls.length, 2);
  assert.ok(urls.some(url => url.includes('locale=de')));
});
