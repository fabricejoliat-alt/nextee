import { readFileSync,readdirSync } from 'node:fs';
export function withoutTransaction(source){return source.replace(/^(?:begin(?: read only)?|commit|rollback);\s*$/gmi,'');}
export function organizationMigrationFiles(){
 const files=readdirSync('supabase/migrations').filter(name=>/^202611(?:1\d|2[0-6])_/.test(name)).sort();
 if(files.length!==17)throw new Error('Expected the 16 organization migrations and personal-history correction');
 return files;
}
// The original migrations were already used on empty Zurich. Keep their source
// intact; fresh populated databases must not run the superseded owner inference.
export function freshPersonalHistorySource(name,source){
 if(name.startsWith('20261120_')) {
  const block=/do \$\$ declare r record; missing boolean; begin[\s\S]*?end \$\$;/;
  if(!block.test(source))throw new Error('Sports ownership transition source changed');
  source=source.replace(block,'-- Personal records keep their existing null organization.');
  source=source.replace("    execute format('alter table public.%I alter column %I set not null',tbl,owner);",'');
 }
 if(name.startsWith('20261122_')) {
  const block=/update public\.player_validation_attempts a set organization_id=\([\s\S]*?end \$\$;\nalter table public\.player_validation_attempts alter column organization_id set not null;/;
  if(!block.test(source))throw new Error('Validation ownership transition source changed');
  source=source.replace(block,'-- Validation progress belongs to the player, without organization backfill.');
 }
 return source;
}
export function migrationBundle(){
 return organizationMigrationFiles().map(name=>{const text=readFileSync(`supabase/migrations/${name}`,'utf8');
  if((text.match(/^begin;\s*$/gmi)??[]).length!==1||(text.match(/^commit;\s*$/gmi)??[]).length!==1)throw new Error('Unexpected migration transaction boundaries');
  return withoutTransaction(freshPersonalHistorySource(name,text));}).join('\n');
}
