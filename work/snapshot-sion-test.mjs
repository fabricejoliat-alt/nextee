import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function envFile(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1)];
  }));
}

const env = envFile(path.join(process.cwd(), '.env.local'));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const clubId = 'ec516bee-09fb-4ff9-8ca6-7131918c5cb0';
const orgId = clubId;
const clubTables = {
  club_members: 'club_id', clubs: 'id', coach_groups: 'club_id', club_events: 'club_id', club_event_series: 'club_id',
  club_camps: 'club_id', club_news: 'club_id', club_player_fields: 'club_id', club_seasons: 'club_id',
  club_parent_intake_configs: 'club_id', organization_settings: 'organization_id', training_volume_settings: 'organization_id',
  training_volume_targets: 'organization_id', organization_members: 'organization_id', programs: 'organization_id',
  message_threads: 'organization_id', om_bonus_entries: 'organization_id', om_tournament_scores: 'organization_id',
  player_dashboard_documents: 'organization_id', om_internal_contests: 'organization_id', om_exceptional_tournaments: 'organization_id',
};
const relationTables = {
  club_event_attendees: ['event_id', 'eventIds'], club_event_coaches: ['event_id', 'eventIds'],
  club_event_coach_feedback: ['event_id', 'eventIds'], club_event_player_feedback: ['event_id', 'eventIds'],
  club_event_structure_items: ['event_id', 'eventIds'], club_event_player_structure_items: ['event_id', 'eventIds'],
  coach_group_players: ['group_id', 'groupIds'], coach_group_coaches: ['group_id', 'groupIds'],
  coach_group_categories: ['group_id', 'groupIds'], club_camp_coaches: ['camp_id', 'campIds'],
  club_camp_days: ['camp_id', 'campIds'], club_camp_groups: ['camp_id', 'campIds'], club_camp_players: ['camp_id', 'campIds'],
  club_member_player_field_values: ['club_member_id', 'memberIds'], golf_round_holes: ['round_id', 'roundIds'],
};

async function all(table, filter) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let q = db.from(table).select('*').range(offset, offset + 999);
    if (filter) q = q.eq(filter[0], filter[1]);
    const result = await q;
    if (result.error) return { error: result.error.message, rows: [] };
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) return { rows };
  }
}

const snapshot = { created_at: new Date().toISOString(), environment: 'test', club_id: clubId, organization_id: orgId, tables: {} };
for (const [table, column] of Object.entries(clubTables)) snapshot.tables[table] = await all(table, [column, column === 'id' ? clubId : column === 'club_id' ? clubId : orgId]);
const groups = (snapshot.tables.coach_groups.rows ?? []).map((row) => row.id);
const events = (snapshot.tables.club_events.rows ?? []).map((row) => row.id);
const camps = (snapshot.tables.club_camps.rows ?? []).map((row) => row.id);
const members = snapshot.tables.club_members.rows ?? [];
const memberIds = members.map((row) => row.id);
const roundIds = [];
for (const table of Object.keys(relationTables)) {
  const [column, key] = relationTables[table];
  const values = key === 'groupIds' ? groups : key === 'eventIds' ? events : key === 'campIds' ? camps : key === 'memberIds' ? memberIds : roundIds;
  snapshot.tables[table] = { rows: [] };
  for (let i = 0; i < values.length; i += 100) {
    const q = await db.from(table).select('*').in(column, values.slice(i, i + 100));
    if (!q.error) snapshot.tables[table].rows.push(...(q.data ?? []));
  }
}
for (const table of ['training_sessions', 'golf_rounds', 'player_activity_events', 'player_handicap_history']) {
  const userIds = [...new Set(members.map((row) => row.user_id).filter(Boolean))];
  const result = await db.from(table).select('*').in('user_id', userIds);
  snapshot.tables[table] = { rows: result.error ? [] : result.data ?? [] };
  if (table === 'golf_rounds') roundIds.push(...snapshot.tables[table].rows.map((row) => row.id));
}
snapshot.tables.golf_round_holes = { rows: [] };
for (let i = 0; i < roundIds.length; i += 100) {
  const q = await db.from('golf_round_holes').select('*').in('round_id', roundIds.slice(i, i + 100));
  if (!q.error) snapshot.tables.golf_round_holes.rows.push(...(q.data ?? []));
}
const output = '/Users/activitee/Documents/Codex/2026-09-18/referenced-chatgpt-conversation-this-is-an/outputs/golf-club-sion-test-backup-20260918.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(snapshot));
console.log(JSON.stringify({ output, tables: Object.fromEntries(Object.entries(snapshot.tables).map(([k, v]) => [k, (v.rows ?? []).length])), bytes: fs.statSync(output).size }));
