import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { protectedTables } from './preservation.mjs';

// TEST predates the two reference catalogs created while bootstrapping Zurich.
// Only these known omissions may be filled; every other protected table is required.
const optionalTables=['training_volume_default_targets','legal_club_templates'];
const expectedHash='dee7d511da8ecf60e850302bcf3ab78a6c3664da7cadf35a3d0bbb252690664c';
export function prerequisiteInventoryQuery(){
 return `select jsonb_build_object('tables',jsonb_build_object(${protectedTables.map(table=>`'${table}',to_regclass('public.${table}') is not null`).join(',')}),
 'ftem_seed_function',to_regprocedure('public.seed_new_club_training_volume()') is not null) inventory;`;
}
export function existingProtectedTables(inventory){
 if(!inventory?.tables||typeof inventory.ftem_seed_function!=='boolean')throw new Error('Invalid TEST prerequisite inventory');
 for(const table of protectedTables){
  if(typeof inventory.tables[table]!=='boolean')throw new Error(`Missing inventory result: ${table}`);
  if(!inventory.tables[table]&&!optionalTables.includes(table))throw new Error(`Required TEST table missing: public.${table}`);
 }
 return protectedTables.filter(table=>inventory.tables[table]);
}
export function testPrerequisiteSource(inventory){
 existingProtectedTables(inventory);
 const assertState=`do $$ begin ${optionalTables.map(table=>`if (to_regclass('public.${table}') is not null) is distinct from ${inventory.tables[table]} then raise exception 'TEST prerequisite state changed: ${table}'; end if;`).join('\n')} end $$;`;
 let source=assertState;
 const ftem=readFileSync('supabase/migrations/20261109_seed_ftem_on_new_club.sql','utf8');
 const functionStart=ftem.indexOf('create or replace function public.seed_new_club_training_volume()');
 const triggerStart=ftem.indexOf('drop trigger if exists seed_new_club_training_volume');
 if(functionStart<0||triggerStart<functionStart)throw new Error('FTEM prerequisite source changed');
 if(!inventory.tables.training_volume_default_targets)source+='\n'+ftem.slice(0,functionStart);
 // An existing seed function is preserved; migration 13 attaches it to organizations.
 if(!inventory.ftem_seed_function)source+='\n'+ftem.slice(functionStart,triggerStart);
 if(!inventory.tables.legal_club_templates){
  const bootstrap=readFileSync('supabase/bootstrap/club-legal-templates-zurich.sql','utf8');
  const tableStart=bootstrap.indexOf('create table public.legal_club_templates');
  const functionStart=bootstrap.indexOf('create function public.create_club_legal_drafts_from_templates');
  if(tableStart<0||functionStart<tableStart)throw new Error('Legal prerequisite source changed');
  // Extract table DDL only: never run the clean-Zurich guard or platform document seed on TEST.
  source+='\n'+bootstrap.slice(tableStart,functionStart);
  const bytes=readFileSync('supabase/bootstrap/legal-catalog-20261006.json');
  if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new Error('Legal reference catalog SHA-256 mismatch');
  const catalog=JSON.parse(bytes);
  if(catalog.format!=='activitee-legal-catalog-v1'||catalog.clubTemplates?.length!==3
    ||new Set(catalog.clubTemplates.map(item=>item.purpose_key)).size!==3)throw new Error('Unexpected legal reference catalog');
  for(const item of catalog.clubTemplates){
   if(Object.keys(item.translations??{}).sort().join()!=='de,en,fr,it'||item.applicability?.status!=='approved')throw new Error('Incomplete legal reference template');
  }
  const payload=JSON.stringify(catalog.clubTemplates).replaceAll("'","''");
  source+=`\ninsert into public.legal_club_templates(purpose_key,kind,audience_roles,action_kind,required,applicability,required_locales,allowed_variables,translations,source_catalog_sha256)
   select item->>'purpose_key',item->>'kind',array(select jsonb_array_elements_text(item->'audience_roles')),
    item->>'action_kind',(item->>'required')::boolean,'{"status":"unapproved"}'::jsonb,
    array(select jsonb_array_elements_text(item->'required_locales')),array(select jsonb_array_elements_text(item->'allowed_variables')),
    item->'translations','${expectedHash}' from jsonb_array_elements('${payload}'::jsonb) item;`;
 }
 source+=`\ndo $$ begin
 ${!inventory.tables.training_volume_default_targets?"if (select count(*) from public.training_volume_default_targets)<>10 then raise exception 'FTEM prerequisite seed incomplete'; end if;":''}
 ${!inventory.tables.legal_club_templates?`if (select count(*) from public.legal_club_templates)<>3 or exists(select 1 from public.legal_club_templates where source_catalog_sha256<>'${expectedHash}' or applicability->>'status'<>'unapproved' or not translations ?& array['fr','en','de','it']) then raise exception 'Legal prerequisite seed incomplete'; end if;`:''}
 end $$;`;
 return source;
}
