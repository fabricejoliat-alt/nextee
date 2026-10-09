import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sealBackup, openBackup } from '../organizations/backup-envelope.mjs';
import { validatePgArchive } from './validate-pg-archive.mjs';

// Deliberately no target/environment override: this runner cannot modify Zurich or legacy production.
const target = 'wizbeuuvjibmmuxyynly';
const mode = process.argv[2] ?? '--plan';
if (process.argv.length > 3 || !['--plan', '--check', '--apply', '--plan-contact', '--repair-contact'].includes(mode)) throw new Error('Use --plan, --check, --apply, --plan-contact or --repair-contact; TEST only');
const contactRepair = ['--plan-contact', '--repair-contact'].includes(mode);
const operation = contactRepair ? 'contact-settings' : 'admin-security';
const batch = readFileSync(contactRepair ? 'docs/security/apply-contact-settings.sql' : 'docs/security/apply-admin-security.sql', 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({ target, mode, operation, migration_sha256: sha(batch), preservation: 'All existing public tables and auth.users fingerprinted; no application records deleted' }));
if (mode === '--plan' || mode === '--plan-contact') process.exit(0);
if (!process.env.PGPASSWORD) throw new Error('Use the shell wrapper for hidden password entry');
if ((mode === '--apply' || mode === '--repair-contact') && (process.env.ACTIVITEE_BACKUP_PASSPHRASE ?? '').length < 16) throw new Error('Encrypted backup passphrase required before changes');

const bin = ['/opt/homebrew/opt/libpq/bin', '/opt/homebrew/bin'].find(path => ['psql', 'pg_dump', 'pg_restore'].every(name => existsSync(`${path}/${name}`)));
if (!bin) throw new Error('PostgreSQL client tools not found');
const env = { ...process.env, PGSSLMODE: 'verify-full', PGSSLROOTCERT: resolve('scripts/organizations/certificates/supabase-prod-ca-2021.crt'), PGOPTIONS: '-c statement_timeout=120000 -c lock_timeout=10000' };
const connection = [`--host=db.${target}.supabase.co`, '--port=5432', '--username=postgres', '--dbname=postgres', '--no-password'];
const psqlArgs = [...connection, '--no-psqlrc', '-X', '-v', 'ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align'];
function sql(source) {
  return execFileSync(`${bin}/psql`, psqlArgs, { input: source, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
}
const preflight = `begin read only;
do $$ declare hook text; begin
  if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Unexpected database identity'; end if;
  if to_regclass('public.app_admins') is null or to_regclass('public.organizations') is null then raise exception 'Required application schema missing'; end if;
  if not exists(select 1 from public.app_admins) then raise exception 'No existing superadmin'; end if;
  for hook in select split_part(setting,'=',2) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting
    where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'
    and (s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname=current_database())) loop
    if coalesce(hook,'') not in ('','public.check_application_session') then raise exception 'Existing unrelated hook must be preserved'; end if;
  end loop;
end $$;
select json_build_object('target','${target}','preflight','passed','admins',(select count(*) from public.app_admins),
  'organizations',(select count(*) from public.organizations),'users',(select count(*) from auth.users),
  'legal_versions',(select count(*) from public.legal_versions),
  'authenticator_pre_request',(select coalesce(json_agg(json_build_object('database_oid',s.setdatabase,'setting',setting)),'[]'::json)
    from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'));
commit;`;
const postflight = `begin read only;
do $$ begin
  if to_regclass('public.admin_security_events') is null then raise exception 'Audit table missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.admin_security_events'::regclass) then raise exception 'Audit RLS missing'; end if;
  if has_function_privilege('authenticated','public.record_admin_security_event(uuid,uuid,text,text,text,integer)','execute')
    or not has_function_privilege('service_role','public.record_admin_security_event(uuid,uuid,text,text,text,integer)','execute')
    or has_table_privilege('service_role','public.admin_security_events','delete')
    or has_table_privilege('service_role','public.admin_security_events','update') then raise exception 'Audit privileges invalid'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
    and c.relname<>'app_admins' and (select count(*) from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname
    and p.policyname in ('application_session_gate','application_update_gate','application_delete_gate') and p.permissive='RESTRICTIVE')<>3) then raise exception 'Session policies incomplete'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='app_admins'
    and policyname in ('admin_bootstrap_gate','admin_bootstrap_insert_gate','admin_bootstrap_update_gate','admin_bootstrap_delete_gate') and permissive='RESTRICTIVE')<>4 then raise exception 'Admin bootstrap policies incomplete'; end if;
  if to_regclass('storage.objects') is not null and (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
    and policyname in ('application_session_gate','application_update_gate','application_delete_gate') and permissive='RESTRICTIVE')<>3 then raise exception 'Storage session policies incomplete'; end if;
  if not exists(select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting where r.rolname='authenticator'
    and setting='pgrst.db_pre_request=public.check_application_session' and s.setdatabase=0) then raise exception 'PostgREST hook missing'; end if;
end $$;
select json_build_object('target','${target}','postflight','passed','admins',(select count(*) from public.app_admins),
  'organizations',(select count(*) from public.organizations),'users',(select count(*) from auth.users),'legal_versions',(select count(*) from public.legal_versions));
commit;`;

let committed = false;
try {
  const before = sql(preflight).trim();
  console.log(before);
  if (mode === '--check') process.exit(0);
  const dump = execFileSync(`${bin}/pg_dump`, [...connection, '--format=custom', '--schema=public', '--schema=auth', '--schema=storage'], { env, maxBuffer: 512 * 1024 * 1024 });
  validatePgArchive(dump, `${bin}/pg_restore`, env);
  const encrypted = sealBackup({ format: 1, project: target, created_at: new Date().toISOString(), label: `before-${operation}`,
    migration_sha256: sha(batch), preflight: JSON.parse(before), postgresql: { schemas: ['public', 'auth', 'storage'], sha256: sha(dump), dump: dump.toString('base64') },
    storage_blob_bytes_included: false, restore_verified: false }, process.env.ACTIVITEE_BACKUP_PASSPHRASE);
  const recovered = openBackup(encrypted, process.env.ACTIVITEE_BACKUP_PASSPHRASE);
  if (sha(Buffer.from(recovered.postgresql.dump, 'base64')) !== sha(dump)) throw new Error('Backup integrity failed');
  mkdirSync('backups/security', { recursive: true, mode: 0o700 });
  const backupPath = `backups/security/test-before-${operation}-${Date.now()}.enc`;
  writeFileSync(backupPath, encrypted, { mode: 0o600 });
  writeFileSync(`${backupPath}.sha256`, `${sha(encrypted)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ backup: backupPath, integrity: 'passed', restore_verified: false, storage_blob_bytes_included: false }));
  console.log(sql(batch).trim());
  committed = true;
  const after = sql(postflight).trim();
  console.log(after);
  mkdirSync('backups/security/receipts', { recursive: true, mode: 0o700 });
  writeFileSync(`backups/security/receipts/test-${operation}-${Date.now()}.json`, JSON.stringify({ target, operation, migration_sha256: sha(batch), backup: backupPath, committed_at: new Date().toISOString(), preflight: JSON.parse(before), postflight: JSON.parse(after), browser_verified: false }, null, 2), { mode: 0o600 });
  console.log(`TEST ${operation} committed; original records preserved. Browser role checks remain required before Zurich.`);
} catch (error) {
  console.error(committed ? 'Migration committed, but postflight failed. Check the database before proceeding.' : 'Stopped before commit; the migration transaction rolls back on error.');
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
}
