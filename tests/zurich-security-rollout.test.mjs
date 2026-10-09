import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {zurichSecurityBatch} from '../scripts/security/zurich-security-batch.mjs';
const runner=new URL('../scripts/security/zurich-admin-security.mjs',import.meta.url);
const require=createRequire(runner);
const code=ts.transpileModule(readFileSync(runner,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function fixture(mode='--apply',failure='',credentials=true) {
 const actions=[],files=[],logs=[],batch=zurichSecurityBatch();
 const process={argv:['node','runner',mode],env:credentials?{PGPASSWORD:'synthetic-password',ACTIVITEE_BACKUP_PASSPHRASE:'synthetic-passphrase',TARGET_SUPABASE_URL:'https://soivxpdcilgltbjbpimt.supabase.co',TARGET_SUPABASE_SERVICE_ROLE_KEY:'synthetic-key'}:{},exit:code=>{throw new Error(`exit:${code}`);},exitCode:0};
 const mockRequire=name=>{
  if(name==='node:fs')return {readFileSync,existsSync:()=>true,mkdirSync:()=>{},writeFileSync:path=>files.push(path)};
  if(name==='./zurich-security-batch.mjs')return {zurichSecurityBatch:()=>batch};
  if(name==='./zurich-security-backup.mjs')return {backupZurichSecurity:async({label})=>{actions.push(label);if(failure===label)throw new Error('synthetic backup failure');return {path:`${label}.enc`};}};
  if(name==='@supabase/supabase-js')return {createClient:url=>{assert.equal(url,'https://soivxpdcilgltbjbpimt.supabase.co');return {};}};
  if(name==='node:child_process')return {execFileSync:(bin,args,options)=>{
   assert.ok(args.includes('--host=db.soivxpdcilgltbjbpimt.supabase.co'));
   assert.equal(options.env.PGSSLMODE,'verify-full');
   if(bin.endsWith('pg_dump')){actions.push('dump');return Buffer.from('synthetic-dump');}
   if(options.input===batch){actions.push('migration');if(failure==='migration')throw new Error('synthetic connection failure');return 'committed';}
   if(options.input.includes('json_agg(illustration_url)'))return '[]';
   if(options.input.includes('json_build_object')){const post=actions.includes('migration');actions.push(post?'postflight':'preflight');if(failure===(post?'postflight':'preflight'))throw new Error('synthetic SQL check failure');return JSON.stringify({clubs:0,organizations:0,users:1});}
   return 'clean_superadmin_reference_base|PASS';
  }};
  return require(name);
 };
 return {actions,files,logs,process,run:()=>new AsyncFunction('require','exports','process','console',code)(mockRequire,{},process,{log:value=>logs.push(value),error:value=>logs.push(value)})};
}
test('Zurich plan is read-only and absent credentials prevent any connection',async()=>{
 const f=fixture('--plan');await assert.rejects(f.run(),/exit:0/);assert.deepEqual(f.actions,[]);
 const missing=fixture('--apply','',false);await assert.rejects(missing.run(),/hidden password/);assert.deepEqual(missing.actions,[]);
});
test('preflight and backup failures prevent applying the Zurich transaction',async()=>{
 for(const failure of ['preflight','before-admin-security']){const f=fixture('--apply',failure);await f.run();assert.equal(f.process.exitCode,1);assert.ok(!f.actions.includes('migration'));assert.deepEqual(f.files,[]);}
});
test('migration is between verified backups; success receipt still requires real production checks',async()=>{
 const f=fixture();await f.run();assert.equal(f.process.exitCode,0);
 assert.ok(f.actions.indexOf('before-admin-security')<f.actions.indexOf('migration'));
 assert.ok(f.actions.indexOf('migration')<f.actions.indexOf('clean-after-admin-security'));
 assert.equal(f.files.length,1);
 assert.ok(!f.logs.join('\n').includes('synthetic-password'));
 assert.ok(!f.logs.join('\n').includes('synthetic-key'));
});
test('unconfirmed commit or failed final backup never creates a success receipt or retries the transaction',async()=>{
 for(const failure of ['migration','postflight','clean-after-admin-security']){const f=fixture('--apply',failure);await f.run();assert.equal(f.process.exitCode,1);assert.deepEqual(f.files,[]);assert.equal(f.actions.filter(x=>x==='migration').length,1);assert.ok(f.logs.some(line=>String(line).includes(failure==='migration'?'outcome not confirmed':'Migration committed')));}
});
