import { readFileSync } from 'node:fs';
import { withoutTransaction } from '../organizations/migration-bundle.mjs';

export const demoMigrationPath = 'supabase/migrations/20261124_organization_demo_mode.sql';
export function organizationDemoBatch(clean = '') {
  return `begin;
${clean}
create temp table demo_mode_checkpoint(table_schema text,table_name text,row_count bigint,fingerprint text) on commit drop;
alter table demo_mode_checkpoint enable row level security;
revoke all on demo_mode_checkpoint from public,anon,authenticated;
do $$ declare t record; n bigint; f text; begin
  for t in select n.nspname schema_name,c.relname table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and (n.nspname='public' or (n.nspname='auth' and c.relname='users')) order by n.nspname,c.relname loop
    execute format('lock table %I.%I in share row exclusive mode',t.schema_name,t.table_name);
    execute format('select count(*),md5(coalesce(jsonb_agg(j order by j::text)::text,''[]'')) from (select to_jsonb(r)%s j from %I.%I r) data',
      case when t.schema_name='public' and t.table_name='organizations' then '-''is_demo''' else '' end,t.schema_name,t.table_name) into n,f;
    insert into demo_mode_checkpoint values(t.schema_name,t.table_name,n,f);
  end loop;
end $$;
${withoutTransaction(readFileSync(demoMigrationPath, 'utf8'))}
do $$ declare t record; n bigint; f text; begin
  for t in select * from demo_mode_checkpoint loop
    execute format('select count(*),md5(coalesce(jsonb_agg(j order by j::text)::text,''[]'')) from (select to_jsonb(r)%s j from %I.%I r) data',
      case when t.table_schema='public' and t.table_name='organizations' then '-''is_demo''' else '' end,t.table_schema,t.table_name) into n,f;
    if n<>t.row_count or f<>t.fingerprint then raise exception 'Existing records changed: %.%',t.table_schema,t.table_name; end if;
  end loop;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='organizations' and column_name='is_demo' and is_nullable='NO') then raise exception 'Demo mode column missing'; end if;
  if has_function_privilege('authenticated','public.create_organization_with_mode_checked(uuid,text,text,text,boolean)','execute')
    or has_function_privilege('authenticated','public.save_organization_settings_checked(uuid,uuid,jsonb,jsonb)','execute')
    or not has_function_privilege('service_role','public.create_organization_with_mode_checked(uuid,text,text,text,boolean)','execute') then raise exception 'Demo mode privileges invalid'; end if;
end $$;
${clean}
select 'organization_demo_mode_committed|existing_records_preserved';
commit;`;
}
