import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function validatePgArchive(dump, restoreBin, env, restore = execFileSync) {
  // --list reads only the TOC and can close stdin before Node finishes writing a large dump.
  // A private temporary file avoids EPIPE and is removed even if validation fails.
  const directory = mkdtempSync(join(tmpdir(), 'activitee-security-archive-'));
  try {
    const path = join(directory, 'database.dump');
    writeFileSync(path, dump, { mode: 0o600 });
    return restore(restoreBin, ['--list', path], { env, maxBuffer: 16 * 1024 * 1024 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
