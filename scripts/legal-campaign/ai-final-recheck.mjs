// Narrow, disposable TEST-only validation of b3f8ae4. Never calls an AI provider.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { db, assertOk, safety, host } from './context.mjs';

const secret = '/private/tmp/activitee-ai-final-recheck-20261005.json';
const proof = 'docs/legal/evidence/20261005-ai-final';
const origin = 'https://test.activitee.golf';
const prior = JSON.parse(await readFile('docs/legal/evidence/20261004-deployed-cleanup.json', 'utf8'));
const group = 'eab5aa57-f25f-4b5d-81e2-408dea246ff2';
const roles = ['coach', 'outsider'];
const ids = ['coach', 'player', 'outsider'].map(role => prior.users[role]);
const clubs = Object.values(prior.clubs);
const mode = process.argv[2];
if (prior.run !== 'legalqa_20261004_9a282f' || prior.project !== host) throw Error('Wrong fixtures');
await safety();
for (const role of ['coach', 'player', 'outsider']) {
  const user = assertOk(await db.auth.admin.getUserById(prior.users[role])).user;
  if (user.email !== `${prior.run}.${role}@example.invalid` || user.user_metadata.legal_campaign !== prior.run) throw Error('Not a fixture');
}
const save = f => writeFile(secret, JSON.stringify(f), { mode: 0o600 });
const evidence = (name, value) => writeFile(`${proof}-${name}.json`, JSON.stringify(value, null, 2) + '\n');
async function state() {
  const control = assertOk(await db.from('legal_enforcement_control').select('enabled').single());
  const counts = {};
  for (const table of ['legal_documents', 'legal_versions', 'legal_decisions']) {
    let q = db.from(table).select('id', { head: true, count: 'exact' });
    if (table === 'legal_documents') q = q.eq('active', true);
    const r = await q; assertOk(r); counts[table] = r.count;
  }
  if (control.enabled !== false || counts.legal_documents !== 0) throw Error('Unsafe legal state');
  return { enabled: control.enabled, ...counts };
}
const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
if (mode === 'setup') {
  if (await stat(secret).then(() => true).catch(() => false)) throw Error('Journal exists; clean up or inspect before another setup');
  const baseline = await state();
  const members = assertOk(await db.from('club_members').select('id,is_active,coach_training_assistance_enabled').in('user_id', ids).in('club_id', clubs));
  const orgMembers = assertOk(await db.from('organization_members').select('organization_id,user_id,is_active').in('user_id', ids).in('organization_id', clubs));
  const orgs = assertOk(await db.from('organizations').select('id,is_active').in('id', clubs));
  const groupRow = assertOk(await db.from('coach_groups').select('id,club_id,is_active,head_coach_user_id').eq('id', group).single());
  const profile = assertOk(await db.from('profiles').select('id,birth_date').eq('id', prior.users.player).single());
  if (members.length !== 3 || members.some(m => m.is_active) || groupRow.is_active || groupRow.club_id !== prior.clubs.A || groupRow.head_coach_user_id !== prior.users.coach) throw Error('Unexpected baseline');
  const f = { run: prior.run, baseline, members, orgMembers, orgs, group: groupRow, profile, users: {}, events: { past: randomUUID(), future: randomUUID() } };
  await save(f);
  await evidence('preflight', { at: new Date().toISOString(), project: host, commit: 'b3f8ae4b7d8c9e38b6f1b38153efb6b9efd82a2f', baseline, fixtureIdentityVerified: true, inactiveMemberships: members.length, groupInactive: true, events: f.events });
  for (const role of roles) {
    const password = randomBytes(30).toString('base64url');
    if (!password || password.length < 24) throw Error('Temporary coach password missing');
    f.users[role] = { id: prior.users[role], email: `${prior.run}.${role}@example.invalid`, password }; await save(f);
    assertOk(await db.auth.admin.updateUserById(prior.users[role], { password, ban_duration: 'none' }));
    f.users[role].token = assertOk(await anon().auth.signInWithPassword({ email: f.users[role].email, password })).session.access_token;
    await save(f);
  }
  assertOk(await db.from('club_members').update({ is_active: true }).in('id', members.map(m => m.id)));
  assertOk(await db.from('club_members').update({ coach_training_assistance_enabled: true }).eq('user_id', prior.users.coach).eq('club_id', prior.clubs.A));
  for (const row of orgMembers) assertOk(await db.from('organization_members').update({ is_active: true }).eq('organization_id', row.organization_id).eq('user_id', row.user_id));
  assertOk(await db.from('organizations').update({ is_active: true }).in('id', clubs));
  assertOk(await db.from('coach_groups').update({ is_active: true }).eq('id', group));
  for (const [kind, id] of Object.entries(f.events)) {
    const start = new Date(Date.now() + (kind === 'past' ? -2 : 2) * 86400000);
    assertOk(await db.from('club_events').insert({ id, group_id: group, club_id: prior.clubs.A, starts_at: start.toISOString(), ends_at: new Date(+start + 3600000).toISOString(), duration_minutes: 60, event_type: 'training', status: 'scheduled', title: `JETABLE AI 20261005 ${kind}`, location_text: 'TEST fictif', created_by: prior.users.coach, requires_evaluation: true }));
    assertOk(await db.from('club_event_coaches').insert({ event_id: id, coach_id: prior.users.coach }));
    assertOk(await db.from('club_event_attendees').insert({ event_id: id, player_id: prior.users.player, status: 'present' }));
  }
  // A deliberately obsolete cache proves that denial does not merely mean empty data.
  assertOk(await db.from('coach_training_preparation_insights').insert({ target_event_id: f.events.future, player_id: prior.users.player, organization_id: prior.clubs.A, group_id: group, history_event_ids: [f.events.past], source_fingerprint: 'a'.repeat(64), attention_points: [{ text: 'JETABLE ancien cache : doit rester inaccessible sans accord.' }], source_event_count: 1, model: 'fixture-no-provider' }));
  console.log({ setup: true, events: f.events, group, legal: await state() });
} else {
  const f = JSON.parse(await readFile(secret, 'utf8'));
  if (f.cleaned) throw Error('Already cleaned');
  if (mode === 'api') {
    await state();
    const checks = [];
    let protectedDeployment = false;
    async function request(name, role, event, path, method, body, valid) {
      if (protectedDeployment) return;
      const response = await fetch(`${origin}/api/coach/events/${event}/${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${f.users[role].token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      protectedDeployment = data?.error?.message === 'Protected deployment';
      const result = { name, status: response.status, body: protectedDeployment ? { message: 'Protected by Vercel Authentication' } : data, cache: response.headers.get('cache-control'), ok: !protectedDeployment && valid(response.status, data), ...(protectedDeployment ? { outcome: 'NOT_VERIFIED', blocker: 'Vercel Authentication before application' } : {}) };
      checks.push(result); console.log(result);
      await evidence('api', { origin, project: host, at: new Date().toISOString(), checks });
    }
    const analysis = { player_id: prior.users.player, source_text: 'JETABLE commentaire sportif fictif.', audience: 'private', locale: 'fr' };
    const seen = { player_id: prior.users.player, source_fingerprint: 'a'.repeat(64) };
    const refused = (status, body) => status === 403 && body.code === 'ai_authorization_required';
    try {
      for (const [name, birthDate] of [['under13_no_consent', '2014-10-06'], ['exactly13_no_consent', '2013-10-05'], ['seventeen_no_consent', '2009-01-01'], ['adult_without_consent', '1990-01-01'], ['unknown_age', null]]) {
        assertOk(await db.from('profiles').update({ birth_date: birthDate }).eq('id', prior.users.player));
        await request(`${name}: preview refused`, 'coach', f.events.past, 'debrief/analyze-player', 'POST', { ...analysis, intent: 'preview' }, refused);
        await request(`${name}: old client refused`, 'coach', f.events.past, 'debrief/analyze-player', 'POST', analysis, refused);
        if (protectedDeployment) break;
        await request(`${name}: preparation excludes old cache`, 'coach', f.events.future, 'preparation-insights', 'GET', null, (s, b) => s === 200 && b.insights?.length === 0 && b.unavailable_player_ids?.includes(prior.users.player));
        await request(`${name}: old acknowledgement`, 'coach', f.events.future, 'preparation-seen', 'PUT', seen, refused);
      }
    } finally { assertOk(await db.from('profiles').update({ birth_date: f.profile.birth_date }).eq('id', prior.users.player)); }
    await request('anonymous analysis', null, f.events.past, 'debrief/analyze-player', 'POST', analysis, s => s === 401);
    await request('other club analysis', 'outsider', f.events.past, 'debrief/analyze-player', 'POST', analysis, s => s === 403);
    await request('other club preparation', 'outsider', f.events.future, 'preparation-insights', 'GET', null, s => s === 403);
    for (const role of ['anon', 'coach', 'outsider']) {
      const client = role === 'anon' ? anon() : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${f.users[role].token}` } } });
      for (const table of ['coach_training_preparation_insights', 'coach_training_preparation_reads']) {
        const r = await client.from(table).select('*').eq('target_event_id', f.events.future);
        const result = { name: `${role}: direct ${table}`, code: r.error?.code, rows: r.data?.length ?? null, ok: r.error?.code === '42501' };
        checks.push(result); console.log(result);
      }
    }
    const reads = assertOk(await db.from('coach_training_preparation_reads').select('target_event_id').eq('target_event_id', f.events.future));
    const cache = assertOk(await db.from('coach_training_preparation_insights').select('model,source_fingerprint').eq('target_event_id', f.events.future).single());
    checks.push({ name: 'denials persisted no read or cache replacement', ok: reads.length === 0 && cache.model === 'fixture-no-provider' && cache.source_fingerprint === 'a'.repeat(64) });
    await evidence('api', { origin, project: host, at: new Date().toISOString(), checks });
    if (checks.some(c => !c.ok)) throw Error('One or more checks failed');
  } else if (mode === 'age') {
    await state();
    const dates = { under13: '2014-10-06', exactly13: '2013-10-05', seventeen: '2009-01-01', adult: '1990-01-01', unknown: null };
    const selected = process.argv[3];
    if (!Object.hasOwn(dates, selected)) throw Error('Choose under13, exactly13, seventeen, adult or unknown');
    assertOk(await db.from('profiles').update({ birth_date: dates[selected] }).eq('id', prior.users.player));
    assertOk(await db.from('coach_training_preparation_insights').update({ attention_points: [{ text: 'JETABLE ancien cache : doit rester inaccessible sans accord.' }] }).eq('target_event_id', f.events.future).eq('player_id', prior.users.player));
    console.log({ fixtureOnly: true, ageCase: selected, birthDate: dates[selected] });
  } else if (mode === 'persisted') {
    const attendee = assertOk(await db.from('club_event_attendees').select('coach_recorded_status,coach_recorded_by,coach_recorded_at').eq('event_id', f.events.past).eq('player_id', prior.users.player).single());
    const feedback = assertOk(await db.from('club_event_coach_feedback').select('engagement,attitude,performance,player_note,private_note').eq('event_id', f.events.past).eq('player_id', prior.users.player).single());
    const debrief = assertOk(await db.from('coach_training_debriefs').select('individual_comments,report_version').eq('event_id', f.events.past).single());
    const manual = { event: f.events.past, attendee, feedback, debrief, ok: attendee.coach_recorded_by === prior.users.coach && attendee.coach_recorded_status === 'present' && feedback.player_note === 'JETABLE 20261005 : saisie manuelle conservee sans IA.' && feedback.private_note === 'JETABLE 20261005 : note privee manuelle.' && debrief.individual_comments[prior.users.player] === feedback.player_note };
    await evidence('manual', manual); console.log(manual); if (!manual.ok) throw Error('Manual persistence mismatch');
  } else if (mode === 'cleanup') {
    const reads = assertOk(await db.from('coach_training_preparation_reads').select('target_event_id').eq('target_event_id', f.events.future));
    const cache = assertOk(await db.from('coach_training_preparation_insights').select('model,source_fingerprint,attention_points').eq('target_event_id', f.events.future).maybeSingle());
    await evidence('post-browser', { at: new Date().toISOString(), reads: reads.length, cache, noGeneratedCache: cache?.model === 'fixture-no-provider', noAcknowledgement: reads.length === 0 });
    for (const id of Object.values(f.events)) {
      const event = assertOk(await db.from('club_events').select('club_id,title').eq('id', id).maybeSingle());
      if (event && (event.club_id !== prior.clubs.A || !event.title.startsWith('JETABLE AI 20261005 '))) throw Error('Unexpected event');
      if (event) {
        // Event-thread FK uses SET NULL; remove these new disposable threads first.
        assertOk(await db.from('message_threads').delete().eq('event_id', id).eq('organization_id', prior.clubs.A));
        assertOk(await db.from('club_events').delete().eq('id', id).eq('club_id', prior.clubs.A));
      }
    }
    assertOk(await db.from('profiles').update({ birth_date: f.profile.birth_date }).eq('id', prior.users.player));
    for (const m of f.members) assertOk(await db.from('club_members').update({ is_active: m.is_active, coach_training_assistance_enabled: m.coach_training_assistance_enabled }).eq('id', m.id));
    for (const m of f.orgMembers) assertOk(await db.from('organization_members').update({ is_active: m.is_active }).eq('organization_id', m.organization_id).eq('user_id', m.user_id));
    for (const o of f.orgs) assertOk(await db.from('organizations').update({ is_active: o.is_active }).eq('id', o.id));
    assertOk(await db.from('coach_groups').update({ is_active: f.group.is_active }).eq('id', group));
    for (const role of roles) {
      if (f.users[role]?.token) await db.auth.admin.signOut(f.users[role].token, 'global');
      assertOk(await db.auth.admin.updateUserById(prior.users[role], { password: randomBytes(32).toString('base64url'), ban_duration: '876000h' }));
    }
    const checks = [];
    const check = (name, ok) => { checks.push({ name, ok }); if (!ok) throw Error(`Cleanup: ${name}`); };
    for (const [table, column] of [['club_events', 'id'], ['club_event_attendees', 'event_id'], ['club_event_coach_feedback', 'event_id'], ['coach_training_debriefs', 'event_id'], ['coach_training_preparation_insights', 'target_event_id'], ['coach_training_preparation_reads', 'target_event_id'], ['message_threads', 'event_id']]) {
      check(`${table} empty for new fixtures`, assertOk(await db.from(table).select(column).in(column, Object.values(f.events))).length === 0);
    }
    const final = await state(); check('legal state unchanged', JSON.stringify(final) === JSON.stringify(f.baseline));
    const members = assertOk(await db.from('club_members').select('id,is_active,coach_training_assistance_enabled').in('id', f.members.map(m => m.id)));
    check('members restored', members.every(m => f.members.some(b => JSON.stringify(m) === JSON.stringify(b))));
    for (const m of f.orgMembers) check('org membership restored', assertOk(await db.from('organization_members').select('is_active').eq('organization_id', m.organization_id).eq('user_id', m.user_id).single()).is_active === m.is_active);
    for (const o of f.orgs) check('organization restored', assertOk(await db.from('organizations').select('is_active').eq('id', o.id).single()).is_active === o.is_active);
    check('group restored', assertOk(await db.from('coach_groups').select('is_active').eq('id', group).single()).is_active === f.group.is_active);
    check('date restored', assertOk(await db.from('profiles').select('birth_date').eq('id', prior.users.player).single()).birth_date === f.profile.birth_date);
    for (const role of roles) check(`${role} banned`, new Date(assertOk(await db.auth.admin.getUserById(prior.users[role])).user.banned_until) > new Date());
    await save({ run: f.run, cleaned: true });
    await evidence('cleanup', { at: new Date().toISOString(), project: host, final, checks, secretsErased: true }); console.log({ cleaned: true, final, checks: checks.length });
  } else throw Error('Choose setup, api, age, persisted or cleanup');
}
await safety();
