-- Read-only checks: no group, activity or structure is changed.
with fn as (
  select p.oid,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) body
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='copy_manager_event_structure_v1'
    and pg_get_function_identity_arguments(p.oid)='p_event_id uuid, p_expected jsonb'
), checks as (
  select 'copy_function_exists' check_name,exists(select 1 from fn) ok
  union all select 'security_definer',coalesce((select prosecdef from fn),false)
  union all select 'fixed_search_path',coalesce((select 'search_path=""'=any(proconfig) from fn),false)
  union all select 'anonymous_denied',coalesce((select not has_function_privilege('anon',oid,'EXECUTE') from fn),false)
  union all select 'authenticated_allowed',coalesce((select has_function_privilege('authenticated',oid,'EXECUTE') from fn),false)
  union all select 'manager_scope_check',coalesce((select body like '%require_manager_club_scope_v1(auth.uid(),source.club_id)%' from fn),false)
  union all select 'snapshot_conflict_check',coalesce((select body like '%actual_targets is distinct from expected_targets%' from fn),false)
  union all select 'future_scheduled_only',coalesce((select body like '%e.starts_at>=now() and e.status=''scheduled''%' from fn),false)
  union all select 'source_snapshot_available',to_regprocedure('public.get_manager_planning_snapshot_v1(uuid)') is not null
)
select check_name,case when ok then 'ok' else 'ERROR' end status from checks order by check_name;
