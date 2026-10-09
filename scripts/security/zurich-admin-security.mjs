import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {zurichSecurityBatch} from './zurich-security-batch.mjs';
import {backupZurichSecurity} from './zurich-security-backup.mjs';
const target='soivxpdcilgltbjbpimt',url=`https://${target}.supabase.co`;
const mode=process.argv[2]??'--plan';
if(process.argv.length>3||!['--plan','--check','--apply'].includes(mode))throw new Error('Use --plan, --check or --apply; Zurich only');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const batch=zurichSecurityBatch();
if(readFileSync('docs/security/apply-zurich-admin-security.sql','utf8')!==batch)throw new Error('Prepared Zurich transaction is stale');
const verification=JSON.parse(readFileSync('docs/security/test-verification.json','utf8'));
if(verification.target!=='wizbeuuvjibmmuxyynly'||verification.admin_migration_sha256!==sha(readFileSync('docs/security/apply-admin-security.sql'))
 ||verification.contact_migration_sha256!==sha(readFileSync('docs/security/apply-contact-settings.sql'))
 ||!verification.contact_update||!verification.ordinary_role_access)throw new Error('TEST validation incomplete or stale');
console.log(JSON.stringify({target,mode,migration_sha256:sha(batch),cleanup:'No deletions; refuse any club, academy or non-superadmin account',backup:'Encrypted PostgreSQL and all reference image bytes before and after migration'}));
if(mode==='--plan')process.exit(0);
if(!process.env.PGPASSWORD)throw new Error('Use shell wrapper for hidden password entry');
if(mode==='--apply'&&((process.env.ACTIVITEE_BACKUP_PASSPHRASE??'').length<16||!process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY||process.env.TARGET_SUPABASE_URL!==url))throw new Error('Zurich credentials and backup passphrase required');
const bin=['/opt/homebrew/opt/libpq/bin','/opt/homebrew/bin'].find(path=>['psql','pg_dump','pg_restore'].every(name=>existsSync(`${path}/${name}`)));
if(!bin)throw new Error('PostgreSQL tools missing');
const env={...process.env,PGSSLMODE:'verify-full',PGSSLROOTCERT:resolve('scripts/organizations/certificates/supabase-prod-ca-2021.crt'),PGOPTIONS:'-c statement_timeout=120000 -c lock_timeout=10000'};
const connection=[`--host=db.${target}.supabase.co`,'--port=5432','--username=postgres','--dbname=postgres','--no-password'];
const sql=source=>execFileSync(`${bin}/psql`,[...connection,'--no-psqlrc','-X','-v','ON_ERROR_STOP=1','--quiet','--tuples-only','--no-align'],{input:source,encoding:'utf8',env,maxBuffer:16*1024*1024});
const clean=readFileSync('supabase/bootstrap/organization-clean-base-check.sql','utf8');
const identity=`do $$ declare hook text; begin
 if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Unexpected database identity'; end if;
 for hook in select split_part(setting,'=',2) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting
 where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%' and (s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname=current_database())) loop
 if coalesce(hook,'') not in ('','public.check_application_session') then raise exception 'Existing unrelated hook must be preserved'; end if;
 end loop;
end $$;`;
const counts=`select json_build_object('target','${target}','admins',(select count(*) from public.app_admins),'organizations',(select count(*) from public.organizations),'clubs',(select count(*) from public.clubs),'users',(select count(*) from auth.users),'legal_versions',(select count(*) from public.legal_versions),
 'authenticator_pre_request',(select coalesce(json_agg(json_build_object('database_oid',s.setdatabase,'setting',setting)),'[]'::json) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'));`;
const readonly=source=>sql(`begin read only;\n${source}\ncommit;`).trim();
const report=source=>{const result=readonly(source);console.log(result);return JSON.parse(result.split('\n').at(-1));};
let committed=false,migrationAttempted=false;
try {
 const before=report(identity+'\n'+clean+'\n'+counts);
 if(mode==='--check')process.exit(0);
 const storage=createClient(url,process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 async function backup(label,preflight) {
  readonly(clean);
  const referenceUrls=JSON.parse(readonly("select coalesce(json_agg(illustration_url),'[]'::json) from public.validation_exercises where illustration_url is not null;"));
  const dump=execFileSync(`${bin}/pg_dump`,[...connection,'--format=custom','--schema=public','--schema=auth','--schema=storage'],{env,maxBuffer:512*1024*1024});
  const result=await backupZurichSecurity({storage,dump,restoreBin:`${bin}/pg_restore`,pgEnv:env,passphrase:process.env.ACTIVITEE_BACKUP_PASSPHRASE,label,migrationSha:sha(batch),referenceUrls,preflight});
  console.log(JSON.stringify({backup:result}));return result;
 }
 const beforeBackup=await backup('before-admin-security',before);
 migrationAttempted=true;
 console.log(sql(batch).trim());committed=true;
 const assertions=`do $$ begin
 if to_regclass('public.admin_security_events') is null then raise exception 'Audit table missing'; end if;
 if not (select relrowsecurity from pg_class where oid='public.admin_security_events'::regclass) then raise exception 'Audit RLS missing'; end if;
 if has_function_privilege('authenticated','public.record_admin_security_event(uuid,uuid,text,text,text,integer)','execute')
 or not has_function_privilege('service_role','public.record_admin_security_event(uuid,uuid,text,text,text,integer)','execute')
 or has_table_privilege('service_role','public.admin_security_events','delete') or has_table_privilege('service_role','public.admin_security_events','update') then raise exception 'Audit privileges invalid'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity and c.relname<>'app_admins'
 and (select count(*) from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname and p.policyname in ('application_session_gate','application_update_gate','application_delete_gate') and p.permissive='RESTRICTIVE')<>3) then raise exception 'Session policies incomplete'; end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename='app_admins' and policyname in ('admin_bootstrap_gate','admin_bootstrap_insert_gate','admin_bootstrap_update_gate','admin_bootstrap_delete_gate') and permissive='RESTRICTIVE')<>4 then raise exception 'Admin bootstrap policies incomplete'; end if;
 if to_regclass('storage.objects') is not null and (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('application_session_gate','application_update_gate','application_delete_gate') and permissive='RESTRICTIVE')<>3 then raise exception 'Storage session policies incomplete'; end if;
 if not exists(select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting where r.rolname='authenticator' and setting='pgrst.db_pre_request=public.check_application_session' and s.setdatabase=0) then raise exception 'PostgREST hook missing'; end if;
 if (select count(*) from public.platform_contact_settings)<>1 or not (select relrowsecurity from pg_class where oid='public.platform_contact_settings'::regclass) or has_table_privilege('anon','public.platform_contact_settings','select') or has_table_privilege('authenticated','public.platform_contact_settings','select')
 or not has_table_privilege('service_role','public.platform_contact_settings','update') then raise exception 'Contact settings incomplete'; end if;
 end $$;`;
 const after=report(identity+'\n'+clean+'\n'+assertions+'\n'+counts);
 const afterBackup=await backup('clean-after-admin-security',after);
 mkdirSync('backups/security/receipts',{recursive:true,mode:0o700});
 writeFileSync(`backups/security/receipts/zurich-admin-security-${Date.now()}.json`,JSON.stringify({target,migration_sha256:sha(batch),committed_at:new Date().toISOString(),preflight:before,postflight:after,backups:[beforeBackup,afterBackup],production_deployed:false,browser_verified:false},null,2),{mode:0o600});
 console.log('Zurich admin security committed; clean superadmin/reference base preserved; encrypted backups verified. Production deployment and MFA browser checks remain.');
}catch(error){
 console.error(committed?'Migration committed, but final verification/backup failed. Check Zurich before retrying.':migrationAttempted?'Migration outcome not confirmed; check Zurich before retrying.':'Stopped before migration; no database changes made.');
 console.error(error.stderr?.toString()||error.message);process.exitCode=1;
}
