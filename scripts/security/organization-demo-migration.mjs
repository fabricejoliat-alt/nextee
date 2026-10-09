import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { organizationDemoBatch, demoMigrationPath } from './organization-demo-batch.mjs';
import { sealBackup, openBackup } from '../organizations/backup-envelope.mjs';
import { backupZurichSecurity } from './zurich-security-backup.mjs';
import { validateFullArchive, main as cleanCheckpoint } from './zurich-clean-checkpoint.mjs';

const environment = process.argv[2];
const mode = process.argv[3] ?? '--plan';
if (process.argv.length > 4 || !['--test', '--zurich'].includes(environment) || !['--plan', '--check', '--apply'].includes(mode)) throw new Error('Use --test or --zurich, then --plan, --check or --apply');
const zurich = environment === '--zurich';
const target = zurich ? 'soivxpdcilgltbjbpimt' : 'wizbeuuvjibmmuxyynly';
const url = `https://${target}.supabase.co`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const migrationSha = sha(readFileSync(demoMigrationPath));
const clean = zurich ? readFileSync('supabase/bootstrap/organization-clean-base-check.sql', 'utf8') : '';
const batch = organizationDemoBatch(clean);
console.log(JSON.stringify({ target, mode, migration_sha256: migrationSha, preservation: 'Existing public records and auth.users preserved; no demo club created', clean_base_required: zurich }));
if (mode === '--plan') process.exit(0);
if (!process.env.PGPASSWORD) throw new Error('Use the shell wrapper for hidden password entry');
if (mode === '--apply' && ((process.env.ACTIVITEE_BACKUP_PASSPHRASE ?? '').length < 16 || (zurich && (!process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY || process.env.TARGET_SUPABASE_URL !== url)))) throw new Error('Backup passphrase and target credentials required');
const bin = ['/opt/homebrew/opt/libpq/bin', '/opt/homebrew/bin'].find(path => ['psql', 'pg_dump', 'pg_restore'].every(name => existsSync(join(path, name))));
if (!bin) throw new Error('PostgreSQL client tools missing');
const env = { ...process.env, PGSSLMODE: 'verify-full', PGSSLROOTCERT: resolve('scripts/organizations/certificates/supabase-prod-ca-2021.crt'), PGCONNECT_TIMEOUT: '20', PGOPTIONS: '-c statement_timeout=120000 -c lock_timeout=10000' };
const connection = [`--host=db.${target}.supabase.co`, '--port=5432', '--username=postgres', '--dbname=postgres', '--no-password'];
const sql = source => execFileSync(join(bin, 'psql'), [...connection, '--no-psqlrc', '-X', '-v', 'ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align'], { input: source, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 }).trim();
const counts = `select jsonb_build_object('target','${target}','organizations',(select count(*) from public.organizations),'clubs',(select count(*) from public.clubs),'users',(select count(*) from auth.users),'admins',(select count(*) from public.app_admins),'legal_versions',(select count(*) from public.legal_versions));`;
const readonly = source => sql(`begin read only;\n${source}\ncommit;`);
const report = () => JSON.parse(readonly(`do $$ begin if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Unexpected database identity'; end if; end $$;\n${clean}\n${counts}`).split('\n').at(-1));
let committed = false;
try {
  const before = report();
  console.log(JSON.stringify({ preflight: 'passed', ...before }));
  if (mode === '--check') process.exit(0);
  const dump = execFileSync(join(bin, 'pg_dump'), [...connection, '--format=custom', '--schema=public', '--schema=auth', '--schema=storage'], { env, maxBuffer: 512 * 1024 * 1024 });
  let backup;
  if (zurich) {
    const storage = createClient(url, process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const urls = JSON.parse(readonly("select coalesce(json_agg(illustration_url),'[]'::json) from public.validation_exercises where illustration_url is not null;"));
    backup = await backupZurichSecurity({ storage, dump, restoreBin: join(bin, 'pg_restore'), pgEnv: env, passphrase: process.env.ACTIVITEE_BACKUP_PASSPHRASE, label: 'before-demo-mode', migrationSha, referenceUrls: urls, preflight: before, directory: 'backups/checkpoints', validateArchive: validateFullArchive });
  } else {
    validateFullArchive(dump, join(bin, 'pg_restore'), env);
    const payload = { format: 1, project: target, created_at: new Date().toISOString(), label: 'before-demo-mode', migration_sha256: migrationSha, preflight: before,
      postgresql: { schemas: ['public', 'auth', 'storage'], sha256: sha(dump), dump: dump.toString('base64') }, storage_blob_bytes_included: false, restore_verified: false };
    const encrypted = sealBackup(payload, process.env.ACTIVITEE_BACKUP_PASSPHRASE);
    mkdirSync('backups/checkpoints', { recursive: true, mode: 0o700 });
    const path = `backups/checkpoints/test-before-demo-mode-${Date.now()}.enc`;
    writeFileSync(path, encrypted, { mode: 0o600 }); writeFileSync(`${path}.sha256`, sha(encrypted) + '\n', { mode: 0o600 });
    const recovered = openBackup(readFileSync(path), process.env.ACTIVITEE_BACKUP_PASSPHRASE);
    if (sha(Buffer.from(recovered.postgresql.dump, 'base64')) !== sha(dump)) throw new Error('Backup verification failed');
    backup = { path, integrity: 'passed', archive_fully_read: true, storage_blob_bytes_included: false, restore_verified: false };
  }
  console.log(JSON.stringify({ backup }));
  console.log(sql(batch)); committed = true;
  const after = report();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Record counts changed; check the committed database before continuing');
  mkdirSync('backups/checkpoints/receipts', { recursive: true, mode: 0o700 });
  const receipt = `backups/checkpoints/receipts/${zurich ? 'zurich' : 'test'}-demo-mode-${Date.now()}.json`;
  writeFileSync(receipt, JSON.stringify({ target, migration_sha256: migrationSha, committed_at: new Date().toISOString(), preflight: before, postflight: after, backup, records_preserved: true, deployed: false }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ postflight: 'passed', ...after, receipt }));
  if (zurich) {
    // Preserve a new clean-base checkpoint with the demo-mode schema, still without a club.
    process.argv = [process.argv[0], process.argv[1], '--backup'];
    await cleanCheckpoint();
  }
  console.log(`${zurich ? 'Zurich' : 'TEST'} demo mode committed; existing records preserved; no demo club created.`);
} catch (error) {
  console.error(committed ? 'Migration committed, but final verification or checkpoint failed. Verify before retrying.' : 'Migration not confirmed. The transaction rolls back on SQL error; verify before retrying.');
  console.error(error.stderr?.toString() || error.message); process.exitCode = 1;
}
