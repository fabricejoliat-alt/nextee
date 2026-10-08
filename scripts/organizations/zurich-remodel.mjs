import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { sourceDigest } from './source-digest.mjs';
import { sealBackup,openBackup } from './backup-envelope.mjs';
import { fingerprintQuery,preservationAssertion } from './preservation.mjs';
import { withoutTransaction,migrationBundle,organizationMigrationFiles } from './migration-bundle.mjs';
const ref='soivxpdcilgltbjbpimt',host=`db.${ref}.supabase.co`,bin='/opt/homebrew/opt/libpq/bin';
const mode=process.argv[2]??'--plan',receipt=JSON.parse(readFileSync('docs/organizations/validation.json','utf8'));
if(!['--plan','--check','--apply','--backup'].includes(mode))throw new Error('Unsupported mode');
const required=['sql','postgrest','business','typescript','lint_delta','build','browser_roles','four_languages','desktop_tablet_mobile','pwa_ios'];
if(receipt.source_sha256!==sourceDigest()||required.some(key=>receipt.gates[key]!=='passed'))throw new Error('Validation incomplete or stale; Zurich is protected. See docs/organizations/implementation.md.');
const migrations=organizationMigrationFiles();
console.log(JSON.stringify({target:ref,mode,migrations:migrations.length,source:receipt.source_sha256,cleanup:'No deletions; stop if business data exists'}));
if(mode==='--plan')process.exit(0);
if(!process.env.PGPASSWORD)throw new Error('Use the shell wrapper for hidden PostgreSQL password entry');
// Supabase signs the database certificate with its own CA, outside the OS trust store.
// Use the public CA linked from this project's SSL settings; keep hostname validation.
const pgEnv={...process.env,PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.PGSSLROOTCERT??join(process.cwd(),'scripts/organizations/certificates/supabase-prod-ca-2021.crt')};
const connection=['--host='+host,'--port=5432','--username=postgres','--dbname=postgres','--no-password'];
const psqlArgs=[...connection,'--no-psqlrc','-X','-v','ON_ERROR_STOP=1'];
function sql(source){return execFileSync(join(bin,'psql'),[...psqlArgs,'--quiet','--tuples-only','--no-align'],{input:source,encoding:'utf8',env:pgEnv,maxBuffer:16*1024*1024});}
const readOnly=source=>sql(`begin read only;\n${withoutTransaction(source)}\ncommit;`);
const clean=readFileSync('supabase/bootstrap/organization-clean-base-check.sql','utf8');
const cleanResult=readOnly(clean);
console.log(cleanResult.trim());
if(mode==='--check'){console.log(readOnly(readFileSync('supabase/bootstrap/organization-remodel-preflight.sql','utf8')));process.exit(0);}
const targetUrl=`https://${ref}.supabase.co`;
if(process.env.TARGET_SUPABASE_URL!==targetUrl||!process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY)throw new Error('Explicit Zurich Storage credentials required; use the shell wrapper');
const storage=createClient(targetUrl,process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fingerprints(){return JSON.parse(readOnly(fingerprintQuery()));}
async function backup(label){
 const dump=execFileSync(join(bin,'pg_dump'),[...connection,'--format=custom','--schema=public','--schema=auth','--schema=storage'],{env:pgEnv,maxBuffer:512*1024*1024});
 const temp=mkdtempSync(join(tmpdir(),'activitee-org-backup-'));
 try{
  const dumpPath=join(temp,'database.dump');writeFileSync(dumpPath,dump,{mode:0o600});
  execFileSync(join(bin,'pg_restore'),['--list',dumpPath],{maxBuffer:16*1024*1024});
 }finally{rmSync(temp,{recursive:true,force:true});}
 const buckets=await storage.storage.listBuckets();if(buckets.error)throw buckets.error;
 const objects=[];
 async function walk(bucket,prefix=''){
  for(let offset=0;;offset+=100){const listed=await storage.storage.from(bucket).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});if(listed.error)throw listed.error;
   for(const object of listed.data){const path=prefix?`${prefix}/${object.name}`:object.name;if(!object.id){await walk(bucket,path);continue;}
    if(bucket!=='validation-exercise-images')throw new Error('Non-reference Storage object found; clean-base review required');
    const downloaded=await storage.storage.from(bucket).download(path);if(downloaded.error)throw downloaded.error;
    const bytes=Buffer.from(await downloaded.data.arrayBuffer());objects.push({bucket,path,metadata:object.metadata,sha256:sha(bytes),bytes:bytes.toString('base64')});
   }if(listed.data.length<100)break;
  }
 }
 for(const bucket of buckets.data)await walk(bucket.id);
 if(objects.length<40)throw new Error('Reference illustration backup is incomplete');
 const payload={format:1,project:ref,created_at:new Date().toISOString(),source_sha256:receipt.source_sha256,label,postgresql:{schemas:['public','auth','storage'],sha256:sha(dump),dump:dump.toString('base64')},buckets:buckets.data,objects,protected_fingerprints:fingerprints(),restore_verified:false};
 const encrypted=sealBackup(payload,process.env.ACTIVITEE_BACKUP_PASSPHRASE??'');
 const restored=openBackup(encrypted,process.env.ACTIVITEE_BACKUP_PASSPHRASE??'');
 if(sha(Buffer.from(restored.postgresql.dump,'base64'))!==payload.postgresql.sha256||restored.objects.some(object=>sha(Buffer.from(object.bytes,'base64'))!==object.sha256))throw new Error('Backup integrity check failed');
 mkdirSync('backups/organizations',{recursive:true,mode:0o700});
 const path=`backups/organizations/zurich-${label}-${Date.now()}.enc`;
 writeFileSync(path,encrypted,{mode:0o600});writeFileSync(path+'.sha256',sha(encrypted)+'\n',{mode:0o600});
 console.log(JSON.stringify({backup:path,illustrations:objects.length,integrity:'passed',restore:'Not yet restored into a separate Supabase project'}));
 return path;
}
if(mode==='--backup'){await backup('clean');process.exit(0);}
if(readOnly("select to_regclass('public.organization_migration_baseline') is not null;").trim()==='t')throw new Error('Remodel already present; use --backup after postflight');
console.log(readOnly(readFileSync('supabase/bootstrap/organization-remodel-preflight.sql','utf8')));
await backup('before-remodel');
const before=fingerprints();
const stripped=migrationBundle();
const verification=preservationAssertion(before);
const applied=sql(`begin;\n${clean}\n${stripped}\n${clean}\n${verification}\n${withoutTransaction(readFileSync('supabase/bootstrap/organization-remodel-postflight.sql','utf8'))}\ncommit;`);
console.log(applied);console.log('Organization remodel committed to Zurich. No legal publication or deployment was performed.');
await backup('clean-after-remodel');
