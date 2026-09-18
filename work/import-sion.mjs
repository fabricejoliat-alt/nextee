import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function envFile(file) { return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((x) => x && !x.startsWith('#') && x.includes('=')).map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; })); }
const readEnv = (file) => envFile(file);
const make = (file) => { const e = readEnv(file); return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); };
const prod = make('.env.production.local');
const test = make('.env.local');
const SOURCE = 'eb710608-aa82-425b-924f-1e554c77be27';
const TARGET = 'ec516bee-09fb-4ff9-8ca6-7131918c5cb0';

const clubSpecs = {
  club_members: 'club_id', coach_groups: 'club_id', club_events: 'club_id', club_event_series: 'club_id', club_camps: 'club_id',
  club_news: 'club_id', club_player_fields: 'club_id', club_seasons: 'club_id', club_parent_intake_configs: 'club_id',
  organization_settings: 'organization_id', training_volume_settings: 'organization_id', training_volume_targets: 'organization_id',
  organization_members: 'organization_id', programs: 'organization_id', om_bonus_entries: 'organization_id',
  om_tournament_scores: 'organization_id', player_dashboard_documents: 'organization_id', om_internal_contests: 'organization_id',
  om_exceptional_tournaments: 'organization_id',
};
const childSpecs = {
  coach_group_players: ['group_id', 'groupIds'], coach_group_coaches: ['group_id', 'groupIds'], coach_group_categories: ['group_id', 'groupIds'],
  club_event_attendees: ['event_id', 'eventIds'], club_event_coaches: ['event_id', 'eventIds'], club_event_coach_feedback: ['event_id', 'eventIds'],
  club_event_player_feedback: ['event_id', 'eventIds'], club_event_structure_items: ['event_id', 'eventIds'], club_event_player_structure_items: ['event_id', 'eventIds'],
  club_event_reminders: ['event_id', 'eventIds'], club_camp_coaches: ['camp_id', 'campIds'], club_camp_days: ['camp_id', 'campIds'],
  club_camp_groups: ['camp_id', 'campIds'], club_camp_options: ['camp_id', 'campIds'], club_camp_players: ['camp_id', 'campIds'],
  club_member_player_field_values: ['club_member_id', 'memberIds'], club_player_season_records: ['club_member_id', 'memberIds'],
  club_coach_season_records: ['club_member_id', 'memberIds'], om_internal_contest_results: ['contest_id', 'contestIds'],
};
const userTables = ['player_guardians', 'player_activity_events', 'training_sessions', 'golf_rounds', 'player_handicap_history', 'player_validation_attempts', 'player_consents', 'player_consent_history'];
const maps = { users: new Map(), groups: new Map(), events: new Map(), series: new Map(), camps: new Map(), members: new Map(), contests: new Map(), rounds: new Map() };

async function all(db, table, column, value) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    let q = db.from(table).select('*').range(offset, offset + 999);
    if (column && value !== undefined) q = Array.isArray(value) ? q.in(column, value) : q.eq(column, value);
    const r = await q;
    if (r.error) { if (/could not find the table|schema cache/i.test(r.error.message)) return []; throw new Error(`${table}: ${r.error.message}`); }
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) return out;
  }
}
async function one(db, table, column, value) { const r = await db.from(table).select('*').eq(column, value).limit(1); return r.data?.[0] ?? null; }
function norm(v) { return String(v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function keyProfile(p) { return [norm(p.username), norm(p.first_name), norm(p.last_name), String(p.birth_date ?? '')].join('|'); }
function remapValue(v) { return typeof v === 'string' && maps.users.has(v) ? maps.users.get(v) : v; }
function remap(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'club_id' || k === 'organization_id') out[k] = TARGET;
    else if (k === 'group_id' && maps.groups.has(v)) out[k] = maps.groups.get(v);
    else if (k === 'event_id' && maps.events.has(v)) out[k] = maps.events.get(v);
    else if (k === 'series_id' && maps.series.has(v)) out[k] = maps.series.get(v);
    else if (k === 'camp_id' && maps.camps.has(v)) out[k] = maps.camps.get(v);
    else if (k === 'contest_id' && maps.contests.has(v)) out[k] = maps.contests.get(v);
    else if (k === 'round_id' && maps.rounds.has(v)) out[k] = maps.rounds.get(v);
    else if (k === 'club_member_id' && maps.members.has(v)) out[k] = maps.members.get(v);
    else if (k === 'program_id' && v === null) out[k] = null;
    else if (k === 'head_coach_user_id' || k === 'coach_user_id' || k === 'created_by' || k === 'updated_by' || k === 'user_id' || k === 'player_id' || k === 'player_user_id' || k === 'coach_id' || k === 'guardian_user_id' || k === 'created_by_user_id' || k === 'changed_by' || k === 'signer_guardian_user_id') out[k] = remapValue(v);
    else out[k] = v;
  }
  return out;
}
async function upsert(table, rows) {
  if (!rows.length) return 0;
  const targetSample = await one(test, table, 'id', rows[0].id ?? '__missing__');
  const keys = targetSample ? Object.keys(targetSample) : Object.keys(rows[0]);
  const idMap = table === 'coach_groups' ? maps.groups : table === 'club_events' ? maps.events : table === 'club_event_series' ? maps.series : table === 'club_camps' ? maps.camps : table === 'club_members' ? maps.members : table === 'om_internal_contests' ? maps.contests : table === 'golf_rounds' ? maps.rounds : null;
  const clean = rows.map((r) => {
    const mapped = remap(r);
    if (idMap?.has(r.id)) mapped.id = idMap.get(r.id);
    return Object.fromEntries(Object.entries(mapped).filter(([k]) => keys.includes(k)));
  });
  for (let i = 0; i < clean.length; i += 200) {
    const r = await test.from(table).upsert(clean.slice(i, i + 200));
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
  }
  return clean.length;
}
async function createOrMapUsers(sourceIds) {
  const sourceProfiles = await all(prod, 'profiles', 'id', sourceIds);
  const targetProfiles = await all(test, 'profiles');
  const byProfile = new Map(targetProfiles.map((p) => [keyProfile(p), p.id]));
  const existing = await (async () => { let out = []; for (let page = 1; ; page++) { const r = await test.auth.admin.listUsers({ page, perPage: 1000 }); if (r.error) throw r.error; out.push(...r.data.users); if (r.data.users.length < 1000) return out; } })();
  const byEmail = new Map(existing.map((u) => [norm(u.email), u.id]));
  for (const sourceId of sourceIds) {
    const profile = sourceProfiles.find((p) => p.id === sourceId) ?? { id: sourceId };
    let targetId = byProfile.get(keyProfile(profile));
    if (!targetId) {
      const email = `imported.${sourceId.replaceAll('-', '')}@noemail.local`;
      targetId = byEmail.get(email);
      if (!targetId) {
        const created = await test.auth.admin.createUser({ email, password: crypto.randomBytes(32).toString('base64url'), email_confirm: true });
        if (created.error) throw new Error(`create user ${sourceId}: ${created.error.message}`);
        targetId = created.data.user.id;
        byEmail.set(email, targetId);
      }
    }
    maps.users.set(sourceId, targetId);
  }
  return sourceProfiles.map((p) => ({ ...p, id: maps.users.get(p.id) })).filter((p) => p.id);
}
async function mapNatural(table, sourceRows, targetRows, keyFn, map) {
  const index = new Map(targetRows.map((r) => [keyFn(r), r.id]));
  for (const r of sourceRows) { const id = index.get(keyFn(remap(r))) ?? r.id; map.set(r.id, id); }
}

const sourceMembers = await all(prod, 'club_members', 'club_id', SOURCE);
const sourceUserIds = [...new Set(sourceMembers.map((r) => r.user_id).filter(Boolean))];
const mappedProfiles = await createOrMapUsers(sourceUserIds);
await upsert('profiles', mappedProfiles);

const sourceGroups = await all(prod, 'coach_groups', 'club_id', SOURCE); const targetGroups = await all(test, 'coach_groups', 'club_id', TARGET);
await mapNatural('coach_groups', sourceGroups, targetGroups, (r) => `${r.club_id}|${norm(r.name)}`, maps.groups); await upsert('coach_groups', sourceGroups);
const sourceSeries = await all(prod, 'club_event_series', 'club_id', SOURCE); const targetSeries = await all(test, 'club_event_series', 'club_id', TARGET);
await mapNatural('club_event_series', sourceSeries, targetSeries, (r) => `${r.club_id}|${norm(r.title)}|${r.start_date ?? ''}`, maps.series); await upsert('club_event_series', sourceSeries);
const sourceCamps = await all(prod, 'club_camps', 'club_id', SOURCE); const targetCamps = await all(test, 'club_camps', 'club_id', TARGET);
await mapNatural('club_camps', sourceCamps, targetCamps, (r) => `${r.club_id}|${norm(r.title)}|${r.created_at ?? ''}`, maps.camps); await upsert('club_camps', sourceCamps);
const sourceEvents = await all(prod, 'club_events', 'club_id', SOURCE); const targetEvents = await all(test, 'club_events', 'club_id', TARGET);
await mapNatural('club_events', sourceEvents, targetEvents, (r) => `${r.club_id}|${r.group_id ?? ''}|${r.starts_at ?? ''}|${norm(r.title)}`, maps.events); await upsert('club_events', sourceEvents);
const targetMembers = await all(test, 'club_members', 'club_id', TARGET); await mapNatural('club_members', sourceMembers, targetMembers, (r) => `${r.club_id}|${r.user_id}|${r.role}`, maps.members); await upsert('club_members', sourceMembers);

const sourceContests = await all(prod, 'om_internal_contests', 'organization_id', SOURCE); const targetContests = await all(test, 'om_internal_contests', 'organization_id', TARGET); await mapNatural('om_internal_contests', sourceContests, targetContests, (r) => `${r.organization_id}|${norm(r.title)}|${r.contest_date ?? ''}`, maps.contests);
for (const [table, column] of Object.entries(clubSpecs)) { if (['club_members', 'coach_groups', 'club_event_series', 'club_camps', 'club_events', 'om_internal_contests'].includes(table)) continue; await upsert(table, await all(prod, table, column, SOURCE)); }
for (const [table, [column, key]] of Object.entries(childSpecs)) { const ids = key === 'groupIds' ? [...maps.groups.keys()] : key === 'eventIds' ? [...maps.events.keys()] : key === 'campIds' ? [...maps.camps.keys()] : key === 'memberIds' ? [...maps.members.keys()] : [...maps.contests.keys()]; await upsert(table, await all(prod, table, column, ids)); }
for (const table of userTables) { const rows = await all(prod, table, table === 'player_guardians' ? 'player_id' : 'user_id', sourceUserIds); await upsert(table, rows); }
const rounds = await all(prod, 'golf_rounds', 'user_id', sourceUserIds); for (const r of rounds) maps.rounds.set(r.id, r.id); await upsert('golf_rounds', rounds); await upsert('golf_round_holes', await all(prod, 'golf_round_holes', 'round_id', rounds.map((r) => r.id)));
console.log(JSON.stringify({ status: 'completed', source_members: sourceMembers.length, mapped_users: maps.users.size, created_test_accounts: mappedProfiles.length }));
