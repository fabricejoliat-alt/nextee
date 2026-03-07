import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
const envRaw = fs.readFileSync(envPath, 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  const key = m[1];
  let val = m[2] ?? '';
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!(key in process.env)) process.env[key] = val;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const targets = [
  { table: 'club_event_player_structure_items', col: 'event_id' },
  { table: 'club_event_structure_items', col: 'event_id' },
  { table: 'club_event_attendees', col: 'event_id' },
  { table: 'club_event_coaches', col: 'event_id' },
  { table: 'training_session_items', col: 'session_id' },
  { table: 'player_activity_events', col: 'id' },
  { table: 'om_internal_contest_results', col: 'contest_id' },
  { table: 'om_bonus_entries', col: 'organization_id' },
  { table: 'om_tournament_scores', col: 'round_id' },
  { table: 'golf_round_holes', col: 'round_id' },
  { table: 'training_sessions', col: 'id' },
  { table: 'club_events', col: 'id' },
  { table: 'club_event_series', col: 'id' },
  { table: 'om_internal_contests', col: 'id' },
  { table: 'golf_rounds', col: 'id' },
];

async function countRows(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) return { table, ok: false, error: error.message, count: null };
  return { table, ok: true, count: count ?? 0 };
}

async function deleteAll(table, col) {
  const { error } = await supabase.from(table).delete().not(col, 'is', null);
  if (error) return { table, ok: false, error: error.message };
  return { table, ok: true };
}

const before = [];
for (const t of targets) before.push(await countRows(t.table));

const deleted = [];
for (const t of targets) deleted.push(await deleteAll(t.table, t.col));

const after = [];
for (const t of targets) after.push(await countRows(t.table));

console.log(JSON.stringify({ before, deleted, after }, null, 2));
