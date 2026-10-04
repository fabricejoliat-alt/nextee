-- Read-only inventory on isolated TEST after postflight 13. Export the full result grid.
-- Candidate RPCs are found by source-text search: dynamic SQL and indirect callees need manual review.
with gate as (
  select enabled from public.legal_enforcement_control where singleton=true
), table_rows as (
  select 'ungated_table'::text as category,n.nspname||'.'||c.relname as item,
    jsonb_build_object('rls_enabled',c.relrowsecurity,
      'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
      'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
      'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
      'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
      'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE')) as details
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and left(c.relname,6)<>'legal_'
    and (has_table_privilege('anon',c.oid,'SELECT')
      or has_table_privilege('authenticated',c.oid,'SELECT')
      or has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE'))
    and not exists(select 1 from pg_policy pol where pol.polrelid=c.oid
      and pol.polname='legal_required_direct_access')
), rpc_rows as (
  select 'candidate_rpc'::text as category,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as item,
    jsonb_build_object('anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'mentions',coalesce((select jsonb_agg(term) from unnest(array[
        'club_events','coach_groups','golf_rounds','player_documents','player_consents',
        'profiles','club_members','marketplace_items','storage.objects','om_ranking_snapshot'
      ]) as terms(term) where position(term in lower(pg_get_functiondef(p.oid)))>0),'[]'::jsonb)) as details
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosecdef
    and p.prorettype<>'pg_catalog.trigger'::regtype
    and left(p.proname,6)<>'legal_'
    and (has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('authenticated',p.oid,'EXECUTE'))
    and exists(select 1 from unnest(array[
      'club_events','coach_groups','golf_rounds','player_documents','player_consents',
      'profiles','club_members','marketplace_items','storage.objects','om_ranking_snapshot'
    ]) as terms(term) where position(term in lower(pg_get_functiondef(p.oid)))>0)
), bucket_rows as (
  select 'storage_bucket'::text as category,b.id::text as item,
    jsonb_build_object('public',b.public,'name',b.name) as details
  from storage.buckets b
)
select 'control'::text as category,'legal_enforcement_control'::text as item,
  jsonb_build_object('enabled',(select enabled from gate),
    'active_documents',(select count(*) from public.legal_documents where active)) as details
union all select category,item,details from table_rows
union all select category,item,details from rpc_rows
union all select category,item,details from bucket_rows
order by category,item;
