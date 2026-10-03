import assert from 'node:assert/strict';
import test from 'node:test';
import { coachComponentHarness, deferred, elements, flush, textContent } from './helpers/coachComponentHarness.ts';
import { messages } from '../lib/i18n/messages.ts';
import { defaultFamilyMailConfig } from '../lib/familyAccess.ts';

const page = 'components/manager/PlayersManagementPage.tsx';
const club = (id: string) => ({ id, name: `Club ${id}` });
const player = (id: string, first_name: string) => ({ id, role: 'player', is_active: true, player_consent_status: 'granted', profiles: { first_name, last_name: 'Junior', birth_date: '2014-04-03', avatar_url: null } });
const season = (id: string) => ({ id: `season-${id}`, name: `Season ${id}`, is_current: true });

async function settle(h: ReturnType<typeof coachComponentHarness>) {
  let tree = h.render();
  for (let index = 0; index < 12; index++) { await flush(); tree = h.render(); }
  return tree;
}

function setup(initialClub = '') {
  const params = new URLSearchParams(initialClub ? { club: initialClub } : {});
  const oldA = deferred<Response>();
  const pendingB = deferred<Response>();
  const reads: string[] = [];
  const routes: string[] = [];
  let aLoads = 0;
  const h = coachComponentHarness(page, {
    fetch: async (input) => {
      const url = String(input); reads.push(url);
      if (url.endsWith('/my-clubs')) return Response.json({ clubs: [club('A'), club('B')] });
      if (url.endsWith('/A/members')) return ++aLoads === 1 ? Response.json({ members: [player('alice', 'Alice'), player('ann', 'Ann')] }) : oldA.promise;
      if (url.endsWith('/B/members')) return pendingB.promise;
      if (url.endsWith('/A/seasons')) return Response.json({ seasons: [season('A')] });
      if (url.endsWith('/B/seasons')) return Response.json({ seasons: [season('B')] });
      if (url.includes('/A/seasons/')) return Response.json({ records: [{ club_member_id: 'alice', registration_status: 'active' }, { club_member_id: 'ann', registration_status: 'active' }] });
      if (url.includes('/B/seasons/')) return Response.json({ error: 'Forbidden' }, { status: 403 });
      throw new Error(`Unexpected request: ${url}`);
    },
    modules: { 'next/navigation': {
      useSearchParams: () => params,
      useRouter: () => ({ replace: (url: string) => { routes.push(url); const next = new URL(url, 'http://local'); params.forEach((_, key) => params.delete(key)); next.searchParams.forEach((value, key) => params.set(key, value)); } }),
    } },
  });
  return { h, params, oldA, pendingB, reads, routes };
}

test('changing the active junior directory club hides the old club even when its refresh finishes late', async () => {
  const x = setup();
  try {
    let tree = await settle(x.h);
    assert.ok(textContent(tree).includes('Junior Alice'));
    const search = elements(tree).find((node) => node.type === 'input' && node.props.placeholder === messages.fr['manager.administration.nameSearch']);
    assert.ok(search);
    search.props.onChange({ target: { value: 'Alice' } });
    tree = x.h.render();
    assert.ok(!textContent(tree).includes('Junior Ann'));
    const registered = elements(tree).find((node) => node.type === 'article' && textContent(node).includes(messages.fr['manager.administration.registered']));
    assert.ok(registered);
    assert.match(textContent(registered), /2/);
    search.props.onChange({ target: { value: '' } });
    tree = x.h.render();
    const refresh = elements(tree).find((node) => node.type === 'button' && textContent(node).includes(messages.fr['manager.refresh']));
    assert.ok(refresh);
    refresh.props.onClick();
    tree = x.h.render();
    const select = elements(tree).find((node) => node.type === 'select' && node.props['aria-label'] === messages.fr['common.club']);
    assert.ok(select);
    select.props.onChange({ target: { value: 'B' } });
    tree = await settle(x.h);
    assert.ok(!textContent(tree).includes('Junior Alice'));
    assert.ok(x.routes.at(-1)?.includes('club=B'));

    x.pendingB.resolve(Response.json({ members: [player('bob', 'Bob')] }));
    tree = await settle(x.h);
    assert.ok(textContent(tree).includes('Junior Bob'));
    assert.ok(!textContent(tree).includes('Junior Alice'));
    assert.ok(textContent(tree).includes(messages.fr['manager.administration.seasonDataError']));
    const status = elements(tree).find((node) => node.type === 'td' && node.props['data-label'] === messages.fr['manager.performance.status']);
    assert.equal(textContent(status).trim(), '—');

    x.oldA.resolve(Response.json({ members: [player('alice', 'Alice')] }));
    tree = await settle(x.h);
    assert.ok(!textContent(tree).includes('Junior Alice'));
    assert.ok(textContent(tree).includes('Junior Bob'));
  } finally { x.h.cleanup(); }
});

test('a requested club determines the directory and its create/import destinations', async () => {
  const x = setup('B');
  try {
    let tree = await settle(x.h);
    assert.ok(!x.reads.some((url) => url.endsWith('/A/members')));
    x.pendingB.resolve(Response.json({ members: [player('bob', 'Bob')] }));
    tree = await settle(x.h);
    assert.ok(textContent(tree).includes('Junior Bob'));
    const links = elements(tree).filter((node) => node.type === 'a').map((node) => String(node.props.href));
    assert.ok(links.some((href) => href.includes('/players/new?club=B')));
    assert.ok(links.some((href) => href.includes('/players/import?club=B')));
    assert.ok(links.some((href) => href.includes('/players/bob?club=B')));
  } finally { x.h.cleanup(); }
});

for (const role of ['coach', 'manager'] as const) test(`the active ${role} directory keeps the requested club and hides old data`, async () => {
  const plural = role === 'coach' ? 'coaches' : 'managers';
  const params = new URLSearchParams({ club: 'B' });
  const reads: string[] = [];
  const pendingB = deferred<Response>();
  const h = coachComponentHarness(`components/manager/${role === 'coach' ? 'Coaches' : 'Managers'}ManagementPage.tsx`, {
    fetch: async (input) => {
      const url = String(input); reads.push(url);
      if (url.endsWith('/my-clubs')) return Response.json({ clubs: [club('A'), club('B')] });
      if (url.endsWith('/B/members')) return pendingB.promise;
      if (url.endsWith('/B/seasons')) return Response.json({ seasons: [season('B')] });
      if (url.includes('/B/seasons/')) return Response.json({ error: 'Forbidden' }, { status: 403 });
      throw new Error(`Unexpected request: ${url}`);
    },
    modules: { 'next/navigation': { useSearchParams: () => params, useRouter: () => ({ replace: () => {} }) } },
  });
  try {
    let tree = await settle(h);
    assert.ok(!reads.some((url) => url.includes('/A/')));
    assert.ok(!textContent(tree).includes('Staff Bea'));
    pendingB.resolve(Response.json({ members: [{ id: 'bea', role, is_active: true, auth_email: 'bea@example.test', profiles: { first_name: 'Bea', last_name: 'Staff', staff_function: 'Coach', phone: '', avatar_url: null } }] }));
    tree = await settle(h);
    assert.ok(textContent(tree).includes('Staff Bea'));
    const links = elements(tree).filter((node) => node.type === 'a').map((node) => String(node.props.href));
    assert.ok(links.some((href) => href.includes(`/${plural}/new?club=B`)));
    assert.ok(links.some((href) => href.includes(`/${plural}/bea?club=B`)));
    if (role === 'coach') {
      assert.ok(textContent(tree).includes(messages.fr['manager.administration.seasonStatusesError']));
      const status = elements(tree).find((node) => node.type === 'td' && node.props['data-label'] === messages.fr['manager.performance.status']);
      assert.equal(textContent(status).trim(), '—');
    }
  } finally { h.cleanup(); }
});

test('family email templates follow the selected club and require confirmation before discarding a draft', async () => {
  const params = new URLSearchParams();
  const routes: string[] = [];
  const writes: string[] = [];
  const pendingB = deferred<Response>();
  let allowDiscard = false;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => allowDiscard } });
  const configA = { ...defaultFamilyMailConfig(), parent_subject: 'Subject A' };
  const configB = { ...defaultFamilyMailConfig(), parent_subject: 'Subject B' };
  const h = coachComponentHarness('components/manager/FamilyEmailConfigurationPage.tsx', {
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT') { writes.push(url); return Response.json({ mail_config: JSON.parse(String(init.body)) }); }
      if (url.endsWith('/my-clubs')) return Response.json({ clubs: [club('A'), club('B')] });
      if (url.includes('/A/')) return Response.json({ mail_config: configA });
      if (url.includes('/B/')) return pendingB.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    modules: { 'next/navigation': {
      useSearchParams: () => params,
      useRouter: () => ({ replace: (url: string) => { routes.push(url); const next = new URL(url, 'http://local'); params.delete('club'); next.searchParams.forEach((value, key) => params.set(key, value)); } }),
    } },
  });
  try {
    let tree = await settle(h);
    assert.ok(textContent(tree).includes('Subject A'));
    const subject = elements(tree).find((node) => node.type === 'input' && node.props.value === 'Subject A');
    assert.ok(subject);
    subject.props.onChange({ target: { value: 'Draft A' } });
    tree = h.render();
    const select = elements(tree).find((node) => node.props.clubs?.length === 2 && typeof node.props.onChange === 'function');
    assert.ok(select);
    select.props.onChange('B');
    assert.equal(routes.length, 0);
    allowDiscard = true;
    select.props.onChange('B');
    tree = await settle(h);
    assert.ok(!textContent(tree).includes('Subject A'));
    assert.ok(!elements(tree).some((node) => node.type === 'input' && node.props.value === 'Draft A'));
    pendingB.resolve(Response.json({ mail_config: configB }));
    tree = await settle(h);
    assert.ok(textContent(tree).includes('Subject B'));
    assert.ok(writes.length === 0);
  } finally {
    h.cleanup();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('season settings discard late responses from another club and protect a new-season draft', async () => {
  const params = new URLSearchParams();
  const routes: string[] = [];
  const pendingA = deferred<Response>();
  const pendingB = deferred<Response>();
  let allowDiscard = false;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => allowDiscard } });
  const h = coachComponentHarness('app/manager/user-management/seasons/page.tsx', {
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/my-clubs')) return Response.json({ clubs: [club('A'), club('B')] });
      if (url.endsWith('/A/seasons')) return pendingA.promise;
      if (url.endsWith('/B/seasons')) return pendingB.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    modules: { 'next/navigation': {
      useSearchParams: () => params,
      useRouter: () => ({ replace: (url: string) => { routes.push(url); const next = new URL(url, 'http://local'); params.delete('club'); next.searchParams.forEach((value, key) => params.set(key, value)); } }),
    } },
  });
  try {
    let tree = await settle(h);
    let select = elements(tree).find((node) => node.type === 'select' && node.props['aria-label'] === messages.fr['common.club']);
    assert.ok(select);
    select.props.onChange({ target: { value: 'B' } });
    tree = await settle(h);
    pendingB.resolve(Response.json({ seasons: [{ id: 'sb', name: 'Season B', starts_on: '2026-01-01', ends_on: '2026-12-31', is_current: true }] }));
    tree = await settle(h);
    assert.ok(textContent(tree).includes('Season B'));
    pendingA.resolve(Response.json({ seasons: [{ id: 'sa', name: 'Season A', starts_on: '2026-01-01', ends_on: '2026-12-31', is_current: true }] }));
    tree = await settle(h);
    assert.ok(!textContent(tree).includes('Season A'));
    const draft = elements(tree).find((node) => node.type === 'input' && node.props.placeholder === '2026–2027');
    assert.ok(draft);
    draft.props.onChange({ target: { value: 'My draft' } });
    tree = h.render();
    select = elements(tree).find((node) => node.type === 'select' && node.props['aria-label'] === messages.fr['common.club']);
    assert.ok(select);
    select.props.onChange({ target: { value: 'A' } });
    assert.equal(routes.length, 1);
    allowDiscard = true;
    select.props.onChange({ target: { value: 'A' } });
    assert.equal(routes.length, 2);
  } finally {
    h.cleanup();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('training volume keeps each club configuration isolated and protects unsaved changes', async () => {
  const params = new URLSearchParams();
  const routes: string[] = [];
  const writes: string[] = [];
  const pendingA = deferred<Response>();
  const pendingB = deferred<Response>();
  let allowDiscard = false;
  let aReads = 0;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => allowDiscard } });
  const volume = (label: string) => ({ rows: [{ id: label, ftem_code: label, level_label: label, handicap_label: '', handicap_min: 0, handicap_max: 10, motivation_text: '', minutes_offseason: 30, minutes_inseason: 60, sort_order: 10 }], settings: { season_months: [4, 5, 6] }, defaults: { rows: [], settings: { season_months: [4, 5, 6] } } });
  const h = coachComponentHarness('app/manager/training-volume/page.tsx', {
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT') { writes.push(url); return Response.json({ ok: true }); }
      if (url.endsWith('/my-clubs')) return Response.json({ clubs: [club('A'), club('B')] });
      if (url.endsWith('/A/training-volume')) return ++aReads === 1 ? pendingA.promise : Response.json(volume('LEVEL_A'));
      if (url.endsWith('/B/training-volume')) return pendingB.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    modules: { 'next/navigation': {
      useSearchParams: () => params,
      useRouter: () => ({ replace: (url: string) => { routes.push(url); const next = new URL(url, 'http://local'); params.delete('club'); next.searchParams.forEach((value, key) => params.set(key, value)); } }),
    } },
  });
  try {
    let tree = await settle(h);
    let select = elements(tree).find((node) => node.type === 'select' && node.props['aria-label'] === messages.fr['common.club']);
    assert.ok(select);
    select.props.onChange({ target: { value: 'B' } });
    tree = await settle(h);
    pendingB.resolve(Response.json(volume('LEVEL_B')));
    tree = await settle(h);
    assert.ok(textContent(tree).includes('LEVEL_B'));
    pendingA.resolve(Response.json(volume('LEVEL_A')));
    tree = await settle(h);
    assert.ok(!textContent(tree).includes('LEVEL_A'));
    const month = elements(tree).find((node) => node.props.role === 'switch');
    assert.ok(month);
    month.props.onClick();
    tree = h.render();
    select = elements(tree).find((node) => node.type === 'select' && node.props['aria-label'] === messages.fr['common.club']);
    assert.ok(select);
    select.props.onChange({ target: { value: 'A' } });
    assert.equal(routes.length, 1);
    allowDiscard = true;
    select.props.onChange({ target: { value: 'A' } });
    tree = await settle(h);
    assert.equal(routes.length, 2);
    assert.ok(textContent(tree).includes('LEVEL_A'), textContent(tree));
    assert.ok(!textContent(tree).includes('LEVEL_B'));
    assert.equal(writes.length, 0);
  } finally {
    h.cleanup();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('AI access displays only coaches from the selected club when responses arrive out of order', async () => {
  const params = new URLSearchParams();
  const pendingA = deferred<Response>();
  const pendingB = deferred<Response>();
  const routes: string[] = [];
  const writes: string[] = [];
  const coach = (id: string, name: string) => ({ id, role: 'coach', is_active: true, coach_training_assistance_enabled: false, profiles: { first_name: name, last_name: 'Coach', staff_function: '', avatar_url: null } });
  const h = coachComponentHarness('app/manager/ai-assistance/page.tsx', {
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method) { writes.push(url); return Response.json({ ok: true }); }
      if (url.endsWith('/my-clubs')) return Response.json({ clubs: [club('A'), club('B')] });
      if (url.endsWith('/A/members')) return pendingA.promise;
      if (url.endsWith('/B/members')) return pendingB.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    modules: { 'next/navigation': {
      useSearchParams: () => params,
      useRouter: () => ({ replace: (url: string) => { routes.push(url); const next = new URL(url, 'http://local'); params.delete('club'); next.searchParams.forEach((value, key) => params.set(key, value)); } }),
    }, '@/components/manager/ManagerMemberAvatar': { default: 'avatar' } },
  });
  try {
    let tree = await settle(h);
    const select = elements(tree).find((node) => node.type === 'select' && node.props.value === 'A');
    assert.ok(select);
    select.props.onChange({ target: { value: 'B' } });
    tree = await settle(h);
    pendingB.resolve(Response.json({ members: [coach('b', 'Bea')] }));
    tree = await settle(h);
    assert.ok(textContent(tree).includes('Bea Coach'));
    pendingA.resolve(Response.json({ members: [coach('a', 'Alice')] }));
    tree = await settle(h);
    assert.ok(!textContent(tree).includes('Alice Coach'));
    assert.equal(elements(tree).filter((node) => node.props.role === 'switch').length, 1);
    assert.equal(writes.length, 0);
    assert.ok(routes.at(-1)?.includes('club=B'));
  } finally { h.cleanup(); }
});

test('evaluation criteria stay in their club and confirm before discarding an editor', async () => {
  const params = new URLSearchParams();
  const pendingA = deferred<Response>();
  const pendingB = deferred<Response>();
  const routes: string[] = [];
  const writes: string[] = [];
  let allowDiscard = false;
  let aReads = 0;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => allowDiscard } });
  const criterion = (id: string) => ({ id, name: `Criterion ${id}`, description: '', respondent: 'coach', response_format: 'yes_no', choices_json: [{ value: true, label: 'Yes' }, { value: false, label: 'No' }], activity_types: ['training'], domain_key: 'technique', domain_label: 'Technique', is_required: false, is_active: true, sort_order: 10, used_count: 0, archived_at: null });
  const h = coachComponentHarness('app/manager/evaluation-criteria/page.tsx', {
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method) { writes.push(url); return Response.json({ ok: true }); }
      if (url.endsWith('/my-clubs')) return Response.json({ clubs: [club('A'), club('B')] });
      if (url.endsWith('/A/evaluation-criteria')) return ++aReads === 1 ? pendingA.promise : Response.json({ criteria: [criterion('A')] });
      if (url.endsWith('/B/evaluation-criteria')) return pendingB.promise;
      throw new Error(`Unexpected request: ${url}`);
    },
    modules: { 'next/navigation': {
      useSearchParams: () => params,
      useRouter: () => ({ replace: (url: string) => { routes.push(url); const next = new URL(url, 'http://local'); params.delete('club'); next.searchParams.forEach((value, key) => params.set(key, value)); } }),
    }, '@/components/evaluations/EvaluationResponseField': { default: 'preview' } },
  });
  try {
    let tree = await settle(h);
    let select = elements(tree).find((node) => node.type === 'select' && node.props.value === 'A');
    assert.ok(select);
    select.props.onChange({ target: { value: 'B' } });
    tree = await settle(h);
    pendingB.resolve(Response.json({ criteria: [criterion('B')] }));
    tree = await settle(h);
    assert.ok(textContent(tree).includes('Criterion B'));
    pendingA.resolve(Response.json({ criteria: [criterion('A')] }));
    tree = await settle(h);
    assert.ok(!textContent(tree).includes('Criterion A'));
    const create = elements(tree).find((node) => node.type === 'button' && textContent(node).includes(messages.fr['manager.administration.criteria.create']));
    assert.ok(create);
    create.props.onClick();
    tree = h.render();
    assert.ok(elements(tree).some((node) => node.props['aria-label'] === messages.fr['manager.administration.criteria.form']));
    select = elements(tree).find((node) => node.type === 'select' && node.props.value === 'B');
    assert.ok(select);
    select.props.onChange({ target: { value: 'A' } });
    assert.equal(routes.length, 1);
    allowDiscard = true;
    select.props.onChange({ target: { value: 'A' } });
    tree = await settle(h);
    assert.equal(routes.length, 2);
    assert.ok(textContent(tree).includes('Criterion A'));
    assert.ok(!textContent(tree).includes('Criterion B'));
    assert.equal(writes.length, 0);
  } finally {
    h.cleanup();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
