import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function sourceDigest(){
 const files=execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'ls-files','-co','--exclude-standard','-z'],{encoding:'utf8'}).split('\0')
  .filter(path=>/^(app\/|components\/|lib\/|supabase\/|scripts\/|tests\/|package(?:-lock)?\.json$|next\.config\.ts$|proxy\.ts$|tsconfig\.json$|eslint\.config\.)/.test(path));
 const hash=createHash('sha256');
 for(const path of [...new Set(files)].sort()){hash.update(path+'\0');hash.update(readFileSync(path));hash.update('\0');}
 return hash.digest('hex');
}
