import { createCipheriv,createDecipheriv,randomBytes,scryptSync } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
const magic=Buffer.from('ACTIVITEE-ORG-BACKUP-1\n');
export function sealBackup(payload,passphrase){
 if(passphrase.length<16)throw new Error('Backup passphrase requires at least 16 characters');
 const salt=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',scryptSync(passphrase,salt,32),iv);
 cipher.setAAD(magic);
 const encrypted=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),cipher.final()]);
 return Buffer.concat([magic,salt,iv,cipher.getAuthTag(),encrypted]);
}
export function openBackup(bytes,passphrase){
 if(!bytes.subarray(0,magic.length).equals(magic))throw new Error('Unknown backup format');
 const offset=magic.length,decipher=createDecipheriv('aes-256-gcm',scryptSync(passphrase,bytes.subarray(offset,offset+32),32),bytes.subarray(offset+32,offset+44));
 decipher.setAAD(magic);decipher.setAuthTag(bytes.subarray(offset+44,offset+60));
 return JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(offset+60)),decipher.final()])).toString());
}
