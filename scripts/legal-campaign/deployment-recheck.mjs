// Deployment smoke checks only, on the previously closed fictional TEST campaign.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { db, assertOk, safety } from './context.mjs';
const secret = '/private/tmp/activitee-legal-deployment-recheck-20261005.json';
const proof = 'docs/legal/evidence/20261005-deployment-recheck';
const prior = JSON.parse(await readFile('docs/legal/evidence/20261004-deployed-cleanup.json', 'utf8'));
if (prior.run !== 'legalqa_20261004_9a282f' || prior.project !== 'wizbeuuvjibmmuxyynly.supabase.co') throw Error('Unexpected fixture campaign');
const roles = ['admin', 'player', 'parent', 'coach', 'manager', 'outsider'];
const ids = Object.values(prior.users), clubs = Object.values(prior.clubs);
const group = 'eab5aa57-f25f-4b5d-81e2-408dea246ff2';
await safety();
for (const role of roles) {
  const user = assertOk(await db.auth.admin.getUserById(prior.users[role])).user;
  if (user.email !== `${prior.run}.${role}@example.invalid` || user.user_metadata.legal_campaign !== prior.run) throw Error('Not a disposable fixture');
}
async function state() {
  const [control, active, versions, decisions] = await Promise.all([
    db.from('legal_enforcement_control').select('enabled').single(),
    db.from('legal_documents').select('id', { head: true, count: 'exact' }).eq('active', true),
    db.from('legal_versions').select('id', { head: true, count: 'exact' }),
    db.from('legal_decisions').select('id', { head: true, count: 'exact' }),
  ]);
  [control, active, versions, decisions].forEach(assertOk);
  return { enabled: control.data.enabled, active: active.count, versions: versions.count, decisions: decisions.count };
}
async function save(f) { await writeFile(secret, JSON.stringify(f), { mode: 0o600 }); }
const mode = process.argv[2];
if (mode === 'setup') {
  const baseline = await state();
  if (baseline.active) throw Error('Expected zero active legal documents');
  const [members, orgMembers, orgs, groupRow, guardian] = await Promise.all([
    db.from('club_members').select('id,is_active').in('user_id', ids).in('club_id', clubs),
    db.from('organization_members').select('organization_id,user_id,is_active').in('user_id', ids).in('organization_id', clubs),
    db.from('organizations').select('id,is_active').in('id', clubs),
    db.from('coach_groups').select('id,club_id,is_active').eq('id', group).single(),
    db.from('player_guardians').select('player_id,guardian_user_id,can_view,can_edit').eq('player_id', prior.users.player).eq('guardian_user_id', prior.users.parent).single(),
  ]);
  [members, orgMembers, orgs, groupRow, guardian].forEach(assertOk);
  if (groupRow.data.club_id !== prior.clubs.A || members.data.some(m => m.is_active)) throw Error('Unexpected fixture baseline');
  const f = { run: prior.run, users: {}, baseline, members: members.data, orgMembers: orgMembers.data, orgs: orgs.data, group: groupRow.data, guardian: guardian.data };
  await save(f);
  for (const role of roles) {
    const password = randomBytes(27).toString('base64url');
    const user = assertOk(await db.auth.admin.updateUserById(prior.users[role], { password, ban_duration: 'none' })).user;
    f.users[role] = { id: user.id, email: user.email, password }; await save(f);
  }
  assertOk(await db.from('app_admins').insert({ user_id: prior.users.admin }));
  assertOk(await db.from('club_members').update({ is_active: true }).in('user_id', ids).in('club_id', clubs));
  assertOk(await db.from('organization_members').update({ is_active: true }).in('user_id', ids).in('organization_id', clubs));
  assertOk(await db.from('organizations').update({ is_active: true }).in('id', clubs));
  assertOk(await db.from('coach_groups').update({ is_active: true }).eq('id', group).eq('club_id', prior.clubs.A));
  assertOk(await db.from('player_guardians').update({ can_view: true, can_edit: true }).eq('player_id', prior.users.player).eq('guardian_user_id', prior.users.parent));
  await writeFile(proof + '-setup.json', JSON.stringify({ run: prior.run, baseline, roles, noDocumentsActivated: true, noRepresentationsChanged: true }, null, 2));
  console.log({ mode, baseline, roles });
} else if (mode === 'direct') {
  const f = JSON.parse(await readFile(secret, 'utf8')); const clients = {};
  for (const role of ['player', 'parent', 'coach', 'manager', 'outsider']) {
    const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const session = assertOk(await c.auth.signInWithPassword(f.users[role])).session;
    f.users[role].token = session.access_token; clients[role] = c; await save(f);
  }
  const checks = [];
  for (const [role, table, id, key, expected] of [
    ['manager', 'coach_groups', group, 'id', 1],
    ['coach', 'club_events', '65a28d29-1c19-48ce-a07a-86dd81d5fddd', 'id', 1],
    ['player', 'thread_messages', 'a761e9d7-adf7-458f-893c-297d8d7274c4', 'id', 1],
    ['player', 'golf_rounds', '9fc412b1-0235-4178-be6c-8e3d6e8dbd71', 'id', 1],
    ['parent', 'golf_rounds', '9fc412b1-0235-4178-be6c-8e3d6e8dbd71', 'id', 1],
    ['outsider', 'club_events', '65a28d29-1c19-48ce-a07a-86dd81d5fddd', 'id', 0],
    ['outsider', 'thread_messages', 'a761e9d7-adf7-458f-893c-297d8d7274c4', 'id', 0],
    ['outsider', 'marketplace_items', '291e5557-bbda-42ba-b98b-58d135199299', 'id', 0],
  ]) {
    const result = await clients[role].from(table).select('id').eq(key, id);
    checks.push({ role, table, expected, rows: result.data?.length, error: result.error?.message ?? null, ok: !result.error && result.data.length === expected });
  }
  await writeFile(proof + '-direct.json', JSON.stringify({ run: f.run, checks }, null, 2));
  console.log(checks);
  if (checks.some(check => !check.ok)) throw Error('Direct access verification failed');
} else if (mode === 'cleanup') {
  const f = JSON.parse(await readFile(secret, 'utf8'));
  for (const m of f.members) assertOk(await db.from('club_members').update({ is_active: m.is_active }).eq('id', m.id));
  for (const m of f.orgMembers) assertOk(await db.from('organization_members').update({ is_active: m.is_active }).eq('organization_id', m.organization_id).eq('user_id', m.user_id));
  for (const o of f.orgs) assertOk(await db.from('organizations').update({ is_active: o.is_active }).eq('id', o.id));
  assertOk(await db.from('coach_groups').update({ is_active: f.group.is_active }).eq('id', group));
  assertOk(await db.from('player_guardians').update({ can_view: f.guardian.can_view, can_edit: f.guardian.can_edit }).eq('player_id', prior.users.player).eq('guardian_user_id', prior.users.parent));
  assertOk(await db.from('app_admins').delete().eq('user_id', prior.users.admin));
  for (const role of roles) {
    if (f.users[role]?.token) await db.auth.admin.signOut(f.users[role].token, 'global');
    assertOk(await db.auth.admin.updateUserById(prior.users[role], { ban_duration: '876000h', password: randomBytes(32).toString('base64url') }));
  }
  const final = await state();
  const memberships = assertOk(await db.from('club_members').select('id').in('user_id', ids).eq('is_active', true));
  const admin = assertOk(await db.from('app_admins').select('user_id').eq('user_id', prior.users.admin));
  for (const m of f.orgMembers) {
    const row = assertOk(await db.from('organization_members').select('is_active').eq('organization_id', m.organization_id).eq('user_id', m.user_id).single());
    if (row.is_active !== m.is_active) throw Error('Organization membership not restored');
  }
  for (const o of f.orgs) {
    const row = assertOk(await db.from('organizations').select('is_active').eq('id', o.id).single());
    if (row.is_active !== o.is_active) throw Error('Organization not restored');
  }
  const finalGroup = assertOk(await db.from('coach_groups').select('is_active').eq('id', group).single());
  const finalGuardian = assertOk(await db.from('player_guardians').select('can_view,can_edit').eq('player_id', prior.users.player).eq('guardian_user_id', prior.users.parent).single());
  if (finalGroup.is_active !== f.group.is_active || finalGuardian.can_view !== f.guardian.can_view || finalGuardian.can_edit !== f.guardian.can_edit) throw Error('Group or guardian link not restored');
  const banned = [];
  for (const role of roles) banned.push(new Date(assertOk(await db.auth.admin.getUserById(prior.users[role])).user.banned_until) > new Date());
  if (JSON.stringify(final) !== JSON.stringify(f.baseline) || memberships.length || admin.length || !banned.every(Boolean)) throw Error('Cleanup verification failed');
  await save({ run: f.run, cleaned: true });
  await writeFile(proof + '-cleanup.json', JSON.stringify({ run: f.run, final, activeMemberships: 0, admins: 0, allUsersBanned: true, baselineRelationsRestored: true, secretsErased: true }, null, 2));
  console.log({ mode, final });
} else throw Error('Choose setup, direct or cleanup');
await safety();
