import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sealBackup } from '../scripts/organizations/backup-envelope.mjs';
import { checkpointTarget, validateFullArchive, verifyCheckpointFile } from '../scripts/security/zurich-clean-checkpoint.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const passphrase = 'synthetic-checkpoint-test-passphrase';

test('full archive validation reads data after TOC without a database connection, then removes the private dump', () => {
  let path;
  const calls = [];
  validateFullArchive(Buffer.from('synthetic'), 'mock-pg-restore', {}, (_bin, args) => {
    path = args.at(-1);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
    assert.equal(readFileSync(path, 'utf8'), 'synthetic');
    calls.push(args[0]);
  });
  assert.deepEqual(calls, ['--list', '--file=/dev/null']);
  assert.equal(existsSync(dirname(path)), false);
});

test('a corrupt data section fails even when the TOC succeeds and removes the temporary dump', () => {
  let path;
  assert.throws(() => validateFullArchive(Buffer.from('synthetic'), 'mock-pg-restore', {}, (_bin, args) => {
    path = args.at(-1);
    if (args[0] !== '--list') throw new Error('Corrupt data section');
  }), /Corrupt data/);
  assert.equal(existsSync(dirname(path)), false);
});

test('checkpoint reread authenticates the encrypted file, project, database and image bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
  const path = join(directory, 'synthetic.enc');
  const image = Buffer.from('synthetic image');
  const dump = Buffer.from('synthetic dump');
  const payload = { project: checkpointTarget, label: 'clean-before-demo', storage_blob_bytes_included: true,
    postgresql: { dump: dump.toString('base64'), sha256: sha(dump) },
    objects: Array.from({ length: 40 }, (_, i) => ({ bucket: 'validation-exercise-images', path: `${i}.png`, bytes: image.toString('base64'), sha256: sha(image) })) };
  function save(value) {
    const bytes = sealBackup(value, passphrase);
    writeFileSync(path, bytes, { mode: 0o600 });
    writeFileSync(`${path}.sha256`, sha(bytes));
  }
  try {
    save(payload);
    assert.equal(verifyCheckpointFile(path, passphrase).encrypted_file_verified, true);
    assert.throws(() => verifyCheckpointFile(path, 'wrong-synthetic-passphrase'));
    writeFileSync(`${path}.sha256`, 'invalid');
    assert.throws(() => verifyCheckpointFile(path, passphrase), /checksum/);
    save({ ...payload, project: 'another-project' });
    assert.throws(() => verifyCheckpointFile(path, passphrase), /identity/);
    save({ ...payload, postgresql: { ...payload.postgresql, sha256: 'invalid' } });
    assert.throws(() => verifyCheckpointFile(path, passphrase), /PostgreSQL/);
    save({ ...payload, objects: payload.objects.map((object, i) => i === 0 ? { ...object, sha256: 'invalid' } : object) });
    assert.throws(() => verifyCheckpointFile(path, passphrase), /illustration/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
