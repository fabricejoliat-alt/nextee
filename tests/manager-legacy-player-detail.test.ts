/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory Supabase query fixture. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { managerLegacyPlayerMessages } from '../lib/i18n/managerLegacyPlayerMessages.ts';
import { coachComponentHarness, deferred, elements, flush, textContent } from './helpers/coachComponentHarness.ts';

const page = 'app/manager/players/[playerId]/page.tsx';
const title = managerLegacyPlayerMessages.fr['manager.legacyPlayers.analysisTitle'];
const empty = { data: [], error: null };

function view() {
  const params = { playerId: 'old' };
  const pending = deferred<any>();
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      in: () => query,
      gte: () => query,
      lt: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: { id: filters.id, first_name: 'Old', last_name: 'Junior', handicap: 10, avatar_url: null }, error: null }),
      then: (resolve: any, reject: any) => {
        calls.push({ table, filters: { ...filters } });
        if (table === 'club_members') {
          const data = filters.user_id === 'manager'
            ? [{ club_id: 'A', role: 'manager', is_active: true }, { club_id: 'B', role: 'coach', is_active: true }]
            : filters.user_id === 'old'
              ? [{ club_id: 'A', role: 'player', is_active: true }]
              : [{ club_id: 'B', role: 'player', is_active: true }];
          return Promise.resolve({ data: data.filter((row) => row.role === filters.role && row.is_active === filters.is_active), error: null }).then(resolve, reject);
        }
        if (table === 'clubs') return Promise.resolve({ data: [{ id: 'A', name: 'Golf A' }], error: null }).then(resolve, reject);
        if (table === 'training_sessions' && filters.user_id === 'old') return pending.promise.then(resolve, reject);
        return Promise.resolve(empty).then(resolve, reject);
      },
    };
    return query;
  };
  const h = coachComponentHarness(page, {
    fetch: async () => Response.json({}), params,
    database: { auth: { getUser: async () => ({ data: { user: { id: 'manager' } }, error: null }) }, from },
    modules: {
      recharts: new Proxy({}, { get: (_, key) => String(key) }),
      '@/components/evaluations/StandardEvaluationIcons': {
        DifficultyIcon: 'icon', EvaluationIconBadge: 'icon', MotivationIcon: 'icon', SatisfactionIcon: 'icon',
      },
    },
  });
  return { h, params, pending, calls };
}

async function settle(h: ReturnType<typeof coachComponentHarness>) {
  let tree = h.render();
  for (let index = 0; index < 8; index++) { await flush(); tree = h.render(); }
  return tree;
}

test('a Manager can view a player in their club, while late responses cannot expose that player after navigation', async () => {
  const x = view();
  try {
    let tree = await settle(x.h);
    assert.ok(textContent(tree).includes(title));
    assert.ok(x.calls.some((call) => call.table === 'training_sessions' && call.filters.user_id === 'old'));

    x.params.playerId = 'other';
    tree = await settle(x.h);
    assert.ok(!textContent(tree).includes(title));
    assert.ok(!textContent(tree).includes('Old Junior'));
    assert.ok(!x.calls.some((call) => call.table === 'training_sessions' && call.filters.user_id === 'other'));

    x.pending.resolve({ data: [{ id: 'late', user_id: 'old', total_minutes: 77 }], error: null });
    tree = await settle(x.h);
    assert.ok(!textContent(tree).includes(title));
    assert.ok(!textContent(tree).includes('Old Junior'));
  } finally { x.h.cleanup(); }
});

test('a coach membership in the target club does not grant access to its player through Manager', async () => {
  const x = view();
  try {
    x.params.playerId = 'other';
    const tree = await settle(x.h);
    assert.ok(!textContent(tree).includes(title));
    assert.ok(x.calls.some((call) => call.table === 'club_members' && call.filters.role === 'manager'));
    assert.ok(x.calls.some((call) => call.table === 'club_members' && call.filters.role === 'player'));
    assert.ok(!x.calls.some((call) => call.table === 'training_sessions'));
    for (const locale of ['fr', 'en', 'de', 'it'] as const) {
      x.h.setLocale(locale);
      assert.ok(textContent(x.h.render()).includes(managerLegacyPlayerMessages[locale]['manager.legacyPlayers.accessDenied']));
    }
  } finally { x.h.cleanup(); }
});

test('the managed-club filter includes sessions coached by someone else and excludes other clubs', async () => {
  const x = view();
  try {
    await settle(x.h);
    x.pending.resolve({ data: [
      { id: 'A1', start_at: '2026-09-01T10:00:00Z', total_minutes: 60, session_type: 'club', club_id: 'A', coach_user_id: 'another-coach' },
      { id: 'B1', start_at: '2026-09-02T10:00:00Z', total_minutes: 90, session_type: 'club', club_id: 'B', coach_user_id: 'manager' },
      { id: 'A2', start_at: '2026-09-03T10:00:00Z', total_minutes: 30, session_type: 'individual', club_id: 'A', coach_user_id: null },
    ], error: null });
    let tree = await settle(x.h);
    assert.match(textContent(tree), /3\s+séances/);
    const control = elements(tree).find((node) => node.type === 'button' && textContent(node).includes('Mes clubs gérés'));
    assert.ok(control);
    control.props.onClick();
    tree = await settle(x.h);
    assert.match(textContent(tree), /1\s+séances/);
    assert.match(textContent(tree), /60\s+MIN/);
  } finally { x.h.cleanup(); }
});
