-- Read-only inventory on isolated TEST after postflight 20.
-- Export this one result grid in full. It is an inventory, not an activation test.
with relations as (
  select 'direct_table'::text as category, n.nspname||'.'||c.relname as item,
    jsonb_build_object(
      'rls',c.relrowsecurity,
      'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
      'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
      'authenticated_write',has_table_privilege('authenticated',c.oid,'INSERT')
        or has_table_privilege('authenticated',c.oid,'UPDATE')
        or has_table_privilege('authenticated',c.oid,'DELETE'),
      'legal_policy',exists(select 1 from pg_policy pol where pol.polrelid=c.oid
        and pol.polname='legal_required_direct_access' and not pol.polpermissive)) as details
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and left(c.relname,6)<>'legal_'
    and (has_table_privilege('anon',c.oid,'SELECT')
      or has_table_privilege('authenticated',c.oid,'SELECT')
      or has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE'))
), routines as (
  select 'client_definer_rpc'::text as category,p.oid::regprocedure::text as item,
    jsonb_build_object(
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'legal_gate_in_body',position('legal_required_' in lower(pg_get_functiondef(p.oid)))>0,
      'owner',pg_get_userbyid(p.proowner)) as details
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosecdef
    and p.prorettype<>'pg_catalog.trigger'::regtype
    and left(p.proname,6)<>'legal_'
    and (has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('authenticated',p.oid,'EXECUTE'))
), buckets as (
  select 'storage_bucket'::text as category,b.id::text as item,
    jsonb_build_object('public',b.public,'name',b.name) as details
  from storage.buckets b
), controls as (
  select 'control'::text as category,'legal_enforcement'::text as item,
    jsonb_build_object(
      'sql_enabled',(select enabled from public.legal_enforcement_control where singleton=true),
      'inactive_constraint',exists(select 1 from pg_constraint
        where conrelid='public.legal_enforcement_control'::regclass
          and conname='legal_enforcement_control_inactive'),
      'active_documents',(select count(*) from public.legal_documents where active),
      'published_versions',(select count(*) from public.legal_versions),
      'decisions',(select count(*) from public.legal_decisions)) as details
)
select category,item,details from controls
union all select category,item,details from relations
union all select category,item,details from routines
union all select category,item,details from buckets
order by category,item;
