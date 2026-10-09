import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {backupZurichSecurity} from '../scripts/security/zurich-security-backup.mjs';
import {openBackup} from '../scripts/organizations/backup-envelope.mjs';
const passphrase='synthetic-backup-passphrase';
function fixture(failure='') {
 const directory=mkdtempSync(join(tmpdir(),'zurich-security-test-'));
 const rows=Array.from({length:40},(_,i)=>({id:String(i),name:`${i}.png`,metadata:{mimetype:'image/png'}}));
 const storage={storage:{listBuckets:async()=>({data:[{id:failure==='private'?'private-files':'validation-exercise-images'}]}),from:()=>({
  list:async()=>({data:rows}),download:async path=>failure==='download'?{error:{message:'synthetic'}}:{data:new Blob([`synthetic-${path}`])}
 })}};
 const args={directory,storage,dump:Buffer.from('synthetic-pg-dump'),restoreBin:'mock-pg-restore',pgEnv:{},passphrase,label:'before-admin-security',migrationSha:'synthetic',referenceUrls:rows.map(row=>`https://soivxpdcilgltbjbpimt.supabase.co/storage/v1/object/public/validation-exercise-images/${row.name}`),preflight:{clubs:0,users:1},validateArchive:()=>{if(failure==='archive')throw new Error('Archive invalid');}};
 return {directory,args,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
test('Zurich backup includes the database, every linked image byte and metadata in an authenticated encrypted archive',async()=>{
 const f=fixture();try{
  const result=await backupZurichSecurity(f.args);
  assert.equal(result.illustrations,40);assert.equal(result.restore_verified,false);
  const bytes=readFileSync(result.path),payload=openBackup(bytes,passphrase);
  assert.equal(Buffer.from(payload.postgresql.dump,'base64').toString(),'synthetic-pg-dump');
  assert.equal(payload.project,'soivxpdcilgltbjbpimt');
  assert.equal(payload.objects.length,40);
  assert.equal(Buffer.from(payload.objects[7].bytes,'base64').toString(),'synthetic-7.png');
  assert.equal(payload.objects[7].metadata.mimetype,'image/png');
  assert.equal(statSync(result.path).mode&0o777,0o600);
  assert.equal(readFileSync(`${result.path}.sha256`,'utf8').trim(),createHash('sha256').update(bytes).digest('hex'));
  assert.ok(readdirSync(f.directory).every(path=>path.endsWith('.enc')||path.endsWith('.sha256')));
 }finally{f.cleanup();}
});
test('archive errors, private objects and download failures prevent creating a successful backup',async()=>{
 for(const failure of ['archive','private','download']){const f=fixture(failure);try{
  await assert.rejects(backupZurichSecurity(f.args));assert.deepEqual(readdirSync(f.directory),[]);
 }finally{f.cleanup();}}
});
test('a missing referenced file or foreign illustration link prevents backup completion',async()=>{
 for(const foreign of [false,true]){const f=fixture();try{
  f.args.referenceUrls[0]=foreign?'https://other.invalid/image.png':'https://soivxpdcilgltbjbpimt.supabase.co/storage/v1/object/public/validation-exercise-images/missing.png';
  await assert.rejects(backupZurichSecurity(f.args),/not fully backed up/);assert.deepEqual(readdirSync(f.directory),[]);
 }finally{f.cleanup();}}
});
