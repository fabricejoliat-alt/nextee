import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { openBackup } from '../organizations/backup-envelope.mjs';
import { protectedTables } from '../organizations/preservation.mjs';
import { backupZurichSecurity } from './zurich-security-backup.mjs';

export const checkpointTarget = 'soivxpdcilgltbjbpimt';
const targetUrl = `https://${checkpointTarget}.supabase.co`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Fully read every archive section without connecting to or restoring any database.
export function validateFullArchive(dump, restoreBin, env, run = execFileSync) {
  const directory = mkdtempSync(join(tmpdir(), 'activitee-clean-checkpoint-'));
  try {
    const path = join(directory, 'database.dump');
    writeFileSync(path, dump, { mode: 0o600 });
    run(restoreBin, ['--list', path], { env, maxBuffer: 16 * 1024 * 1024 });
    run(restoreBin, ['--file=/dev/null', path], { env, maxBuffer: 16 * 1024 * 1024 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function verifyCheckpointFile(path, passphrase) {
  const bytes = readFileSync(path);
  if (sha(bytes) !== readFileSync(`${path}.sha256`, 'utf8').trim()) throw new Error('Encrypted checkpoint checksum mismatch');
  const payload = openBackup(bytes, passphrase);
  if (payload.project !== checkpointTarget || payload.label !== 'clean-before-demo') throw new Error('Unexpected checkpoint identity');
  if (sha(Buffer.from(payload.postgresql.dump, 'base64')) !== payload.postgresql.sha256) throw new Error('PostgreSQL checksum mismatch');
  if (!payload.storage_blob_bytes_included || payload.objects.length < 40 || payload.objects.some(object =>
    object.bucket !== 'validation-exercise-images' || sha(Buffer.from(object.bytes, 'base64')) !== object.sha256)) throw new Error('Reference illustration integrity failed');
  return { sha256: sha(bytes), illustrations: payload.objects.length, encrypted_file_verified: true };
}

export async function main() {
  const mode = process.argv[2] ?? '--plan';
  if (process.argv.length > 3 || !['--plan', '--check', '--backup'].includes(mode)) throw new Error('Use --plan, --check or --backup; Zurich only');
  const clean = readFileSync('supabase/bootstrap/organization-clean-base-check.sql', 'utf8');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceSha = sha(Buffer.concat([readFileSync(import.meta.filename), Buffer.from(clean)]));
  console.log(JSON.stringify({ target: checkpointTarget, mode, operation: 'clean-before-demo-checkpoint', database_changes: false, includes: ['public', 'auth', 'storage', 'reference-image-bytes'], commit }));
  if (mode === '--plan') return;
  if (!process.env.PGPASSWORD) throw new Error('Use the shell wrapper for hidden PostgreSQL password entry');
  if (mode === '--backup' && ((process.env.ACTIVITEE_BACKUP_PASSPHRASE ?? '').length < 16 || !process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY || process.env.TARGET_SUPABASE_URL !== targetUrl)) throw new Error('Zurich credentials and backup passphrase required');
  const bin = ['/opt/homebrew/opt/libpq/bin', '/opt/homebrew/bin'].find(path => ['psql', 'pg_dump', 'pg_restore'].every(name => existsSync(join(path, name))));
  if (!bin) throw new Error('PostgreSQL client tools missing');
  const env = { ...process.env, PGSSLMODE: 'verify-full', PGSSLROOTCERT: resolve('scripts/organizations/certificates/supabase-prod-ca-2021.crt'), PGCONNECT_TIMEOUT: '20', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=10000' };
  const connection = [`--host=db.${checkpointTarget}.supabase.co`, '--port=5432', '--username=postgres', '--dbname=postgres', '--no-password'];
  const readonly = source => execFileSync(join(bin, 'psql'), [...connection, '--no-psqlrc', '-X', '-v', 'ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align'], {
    input: `begin isolation level repeatable read read only;\n${source}\ncommit;`, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024,
  }).trim();
  const counts = ['app_admins', 'profiles', 'clubs', 'organizations', 'legal_documents', 'legal_versions', 'legal_club_templates', 'rules_series', 'rules_cards', 'rules_questions', 'etiquette_themes', 'etiquette_cards', 'validation_sections', 'validation_exercises', 'training_volume_default_targets'];
  const fingerprints = [...new Set([...protectedTables, 'legal_documents', 'app_admins', 'profiles'])];
  const query = `
    do $$ begin if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Unexpected database identity'; end if; end $$;
    ${clean}
    select jsonb_build_object('target','${checkpointTarget}', 'clean_base','passed',
      'counts',jsonb_build_object(${counts.map(table => `'${table}',(select count(*) from public.${table})`).join(',')},'users',(select count(*) from auth.users),'academies',(select count(*) from public.organizations where org_type='academy')),
      'fingerprints',jsonb_build_object(${fingerprints.map(table => `'${table}',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.${table} t)`).join(',')},
        'auth.users',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from auth.users t),
        'auth.mfa_factors',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from auth.mfa_factors t)),
      'illustration_urls',(select coalesce(jsonb_agg(illustration_url order by illustration_url),'[]'::jsonb) from public.validation_exercises where illustration_url is not null),
      'authenticator_pre_request',(select coalesce(jsonb_agg(jsonb_build_object('database_oid',s.setdatabase,'setting',setting) order by s.setdatabase,setting),'[]'::jsonb) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'));
  `;
  const report = () => JSON.parse(readonly(query).split('\n').at(-1));
  const before = report();
  console.log(JSON.stringify({ preflight: before.clean_base, target: checkpointTarget, counts: before.counts }));
  if (mode === '--check') return;
  const storage = createClient(targetUrl, process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const dump = execFileSync(join(bin, 'pg_dump'), [...connection, '--format=custom', '--schema=public', '--schema=auth', '--schema=storage'], { env, maxBuffer: 512 * 1024 * 1024 });
  const backup = await backupZurichSecurity({ storage, dump, restoreBin: join(bin, 'pg_restore'), pgEnv: env, passphrase: process.env.ACTIVITEE_BACKUP_PASSPHRASE,
    label: 'clean-before-demo', migrationSha: sourceSha, referenceUrls: before.illustration_urls, preflight: before, directory: 'backups/checkpoints', validateArchive: validateFullArchive });
  const integrity = verifyCheckpointFile(backup.path, process.env.ACTIVITEE_BACKUP_PASSPHRASE);
  const after = report();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Clean-base catalogs, identities or legal records changed during backup; checkpoint is not validated. No cleanup performed');
  const receipt = { target: checkpointTarget, label: 'clean-before-demo', created_at: new Date().toISOString(), commit, source_sha256: sourceSha,
    preflight: before, postflight: after, backup: { ...backup, ...integrity, archive_fully_read: true }, database_changes: false, restore_verified: false,
    restore_notes: 'Database restoration in a separate project not performed. Configure project Auth/SMTP and server secrets separately; recreate the recorded authenticator hook during a reviewed restoration.' };
  mkdirSync('backups/checkpoints/receipts', { recursive: true, mode: 0o700 });
  const receiptPath = `backups/checkpoints/receipts/zurich-clean-before-demo-${Date.now()}.json`;
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ target: checkpointTarget, checkpoint: 'passed', counts: after.counts, backup: receipt.backup, receipt: receiptPath, database_changes: false }));
  console.log('Zurich clean-before-demo checkpoint verified and saved; no database records changed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('Checkpoint not completed. No database writes or automatic cleanup performed.');
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  });
}
