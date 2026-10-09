import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {sealBackup,openBackup} from '../organizations/backup-envelope.mjs';
import {validatePgArchive} from './validate-pg-archive.mjs';
const target='soivxpdcilgltbjbpimt';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function backupZurichSecurity({storage,dump,restoreBin,pgEnv,passphrase,label,migrationSha,referenceUrls,preflight,directory='backups/security',validateArchive=validatePgArchive}) {
 validateArchive(dump,restoreBin,pgEnv);
 const listed=await storage.storage.listBuckets();
 if(listed.error)throw new Error('Zurich Storage bucket listing failed');
 const objects=[];let totalBytes=0;
 async function walk(bucket,prefix='') {
  for(let offset=0;;offset+=100) {
   const result=await storage.storage.from(bucket).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
   if(result.error)throw new Error('Zurich Storage object listing failed');
   for(const object of result.data) {
    const path=prefix?`${prefix}/${object.name}`:object.name;
    if(!object.id){await walk(bucket,path);continue;}
    if(bucket!=='validation-exercise-images')throw new Error('Non-reference Storage data found; no migration allowed');
    const downloaded=await storage.storage.from(bucket).download(path);
    if(downloaded.error)throw new Error('Zurich reference image download failed');
    const bytes=Buffer.from(await downloaded.data.arrayBuffer());totalBytes+=bytes.length;
    if(totalBytes>128*1024*1024)throw new Error('Reference backup exceeds expected size; review required');
    objects.push({bucket,path,metadata:object.metadata,sha256:sha(bytes),bytes:bytes.toString('base64')});
   }
   if(result.data.length<100)break;
  }
 }
 for(const bucket of listed.data)await walk(bucket.id);
 const prefix=`https://${target}.supabase.co/storage/v1/object/public/validation-exercise-images/`;
 const paths=new Set(objects.map(object=>object.path));
 if(objects.length<40||referenceUrls.length<40||referenceUrls.some(url=>!url.startsWith(prefix)||!paths.has(decodeURIComponent(url.slice(prefix.length)))))throw new Error('Reference illustrations are not fully backed up');
 const payload={format:1,project:target,created_at:new Date().toISOString(),label,migration_sha256:migrationSha,preflight,
  postgresql:{schemas:['public','auth','storage'],sha256:sha(dump),dump:dump.toString('base64')},
  buckets:listed.data,objects,storage_blob_bytes_included:true,restore_verified:false};
 const encrypted=sealBackup(payload,passphrase),recovered=openBackup(encrypted,passphrase);
 if(sha(Buffer.from(recovered.postgresql.dump,'base64'))!==sha(dump)||recovered.objects.some(object=>sha(Buffer.from(object.bytes,'base64'))!==object.sha256))throw new Error('Backup integrity failed');
 mkdirSync(directory,{recursive:true,mode:0o700});
 const path=`${directory}/zurich-${label}-${Date.now()}.enc`;
 writeFileSync(path,encrypted,{mode:0o600});writeFileSync(`${path}.sha256`,sha(encrypted)+'\n',{mode:0o600});
 return {path,illustrations:objects.length,integrity:'passed',storage_blob_bytes_included:true,restore_verified:false};
}
