import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealBackup,openBackup } from '../scripts/organizations/backup-envelope.mjs';
test('Encrypted backup preserves database and images and rejects corruption/wrong password',()=>{
 const fixture={postgresql:{dump:Buffer.from('synthetic database export').toString('base64')},objects:[{bytes:Buffer.from([0,255,42]).toString('base64')}]};
 const bytes=sealBackup(fixture,'Disposable fixture recovery passphrase');
 assert.deepEqual(openBackup(bytes,'Disposable fixture recovery passphrase'),fixture);
 assert.throws(()=>openBackup(bytes,'A different recovery passphrase'));
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 assert.throws(()=>openBackup(corrupt,'Disposable fixture recovery passphrase'));
 assert.throws(()=>sealBackup(fixture,'short'));
});
