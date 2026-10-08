import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { sourceDigest } from './source-digest.mjs';
import { migrationBundle,organizationMigrationFiles,withoutTransaction } from './migration-bundle.mjs';
import { fingerprintQuery,preservationAssertion } from './preservation.mjs';
import { historyCheckpoint,historyAssertion,testHistoryTables } from './test-history-preservation.mjs';
import { sealBackup,openBackup } from './backup-envelope.mjs';
import { prerequisiteInventoryQuery,existingProtectedTables,testPrerequisiteSource } from './test-prerequisites.mjs';
const ref='wizbeuuvjibmmuxyynly',host=`db.${ref}.supabase.co`,bin='/opt/homebrew/opt/libpq/bin';
const mode=process.argv[2]??'--plan';
if(!['--plan','--check','--apply'].includes(mode))throw new Error('Use --plan, --check or --apply');
const receipt=JSON.parse(readFileSync('docs/organizations/test-validation.json','utf8'));
if(receipt.source_sha256!==sourceDigest()||['sql','postgrest','typescript'].some(key=>receipt.gates[key]!=='passed'))throw new Error('TEST validation is incomplete or stale');
console.log(JSON.stringify({target:ref,mode,migrations:organizationMigrationFiles().length,ownership:'Personal history remains with player; no club assignment',cleanup:'No application records deleted'}));
if(mode==='--plan')process.exit(0);
if(!process.env.PGPASSWORD)throw new Error('Use the shell wrapper for hidden TEST password entry');
const env={...process.env,PGSSLMODE:'verify-full',PGSSLROOTCERT:join(process.cwd(),'scripts/organizations/certificates/supabase-prod-ca-2021.crt')};
const connection=[`--host=${host}`,'--port=5432','--username=postgres','--dbname=postgres','--no-password'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function sql(source){return execFileSync(join(bin,'psql'),[...connection,'--no-psqlrc','-X','-v','ON_ERROR_STOP=1','--quiet','--tuples-only','--no-align'],{input:source,encoding:'utf8',env,maxBuffer:32*1024*1024});}
const readOnly=source=>sql('begin read only;\n'+withoutTransaction(source)+'\ncommit;');
const postflight=readFileSync('supabase/bootstrap/organization-remodel-postflight.sql','utf8');
const migrated=readOnly("select to_regclass('public.organization_migration_baseline') is not null;").trim()==='t';
if(migrated){console.log(readOnly(postflight));if(mode==='--apply')throw new Error('Remodel already exists. No migration reapplied; inspect the postflight above.');process.exit(0);}
console.log(readOnly(readFileSync('supabase/bootstrap/organization-remodel-preflight.sql','utf8')));
const inventory=JSON.parse(readOnly(prerequisiteInventoryQuery()));
const protectedExisting=existingProtectedTables(inventory);
const prerequisites=testPrerequisiteSource(inventory);
const missingCatalogs=Object.entries(inventory.tables).filter(([,exists])=>!exists).map(([name])=>name);
console.log(JSON.stringify({missing_reference_catalogs:missingCatalogs,preparation:'Only missing reference catalogs; inside migration transaction after encrypted backup'}));
if(mode==='--check')process.exit(0);
if((process.env.ACTIVITEE_BACKUP_PASSPHRASE??'').length<16)throw new Error('A backup passphrase of at least 16 characters is required');
const fingerprints=JSON.parse(readOnly(fingerprintQuery(protectedExisting)));
const dump=execFileSync(join(bin,'pg_dump'),[...connection,'--format=custom','--schema=public','--schema=auth','--schema=storage'],{env,maxBuffer:512*1024*1024});
const temp=mkdtempSync(join(tmpdir(),'activitee-test-remodel-'));
try{const path=join(temp,'database.dump');writeFileSync(path,dump,{mode:0o600});execFileSync(join(bin,'pg_restore'),['--list',path],{maxBuffer:32*1024*1024});}finally{rmSync(temp,{recursive:true,force:true});}
const payload={format:1,project:ref,label:'before-personal-remodel',created_at:new Date().toISOString(),source_sha256:receipt.source_sha256,
 postgresql:{schemas:['public','auth','storage'],sha256:sha(dump),dump:dump.toString('base64')},protected_fingerprints:fingerprints,
 prerequisite_inventory:inventory,storage_bytes_included:false,storage_changes:false,restore_verified:false};
const encrypted=sealBackup(payload,process.env.ACTIVITEE_BACKUP_PASSPHRASE);
if(sha(Buffer.from(openBackup(encrypted,process.env.ACTIVITEE_BACKUP_PASSPHRASE).postgresql.dump,'base64'))!==payload.postgresql.sha256)throw new Error('Backup integrity verification failed');
mkdirSync('backups/organizations',{recursive:true,mode:0o700});
const path=`backups/organizations/test-before-personal-remodel-${Date.now()}.enc`;
writeFileSync(path,encrypted,{mode:0o600});writeFileSync(path+'.sha256',sha(encrypted)+'\n',{mode:0o600});
console.log(JSON.stringify({backup:path,integrity:'passed',scope:'PostgreSQL public/auth/storage; blob bytes unchanged and not included',restore_verified:false}));
// Lock preserved application tables, snapshot their original columns, migrate and
// compare in a single transaction. Concurrent history writes wait until commit.
const output=sql(`begin; set local lock_timeout='10s'; set local statement_timeout='180s';
 lock table ${[...new Set([...testHistoryTables,...protectedExisting.map(name=>'public.'+name)])].join(',')} in share row exclusive mode;
 ${historyCheckpoint()}
 ${withoutTransaction(readFileSync('supabase/bootstrap/organization-remodel-preflight.sql','utf8'))}
 ${prerequisites}
 ${migrationBundle()}
 ${historyAssertion()}
 ${preservationAssertion(fingerprints)}
 ${withoutTransaction(postflight)}
 commit;`);
console.log(output);
console.log('TEST organization and personal-history migrations committed; original accounts, history and legal evidence preserved.');
writeFileSync('docs/organizations/evidence/test-remodel-result.json',JSON.stringify({target:ref,applied_at:new Date().toISOString(),source_sha256:receipt.source_sha256,backup:path,migrations:17,created_reference_catalogs:missingCatalogs,history_preservation:'passed',catalog_legal_preservation:'passed',postflight:'passed',storage_changes:false},null,2)+'\n');
