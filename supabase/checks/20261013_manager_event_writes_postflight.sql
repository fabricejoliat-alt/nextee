-- Read-only checks: no activity, participant or notification is changed.
with funcs as (
 select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) body
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_manager_events_v1','delete_manager_planning_v1')
), checks as (
 select 'create_function_exists' check_name, to_regprocedure('public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])') is not null ok
 union all select 'delete_function_exists',to_regprocedure('public.delete_manager_planning_v1(uuid,uuid,uuid,boolean)') is not null
 union all select 'definer_functions',count(*)=2 and bool_and(prosecdef) from funcs
 union all select 'fixed_search_paths',count(*)=2 and bool_and('search_path=""'=any(proconfig)) from funcs
 union all select 'anonymous_denied',count(*)=2 and bool_and(not has_function_privilege('anon',oid,'EXECUTE')) from funcs
 union all select 'client_creation_allowed',coalesce((select has_function_privilege('authenticated',oid,'EXECUTE') from funcs where proname='create_manager_events_v1'),false)
 union all select 'client_deletion_denied',coalesce((select not has_function_privilege('authenticated',oid,'EXECUTE') from funcs where proname='delete_manager_planning_v1'),false)
 union all select 'server_deletion_allowed',coalesce((select has_function_privilege('service_role',oid,'EXECUTE') from funcs where proname='delete_manager_planning_v1'),false)
 union all select 'manager_scope_checks',count(*)=2 and bool_and(body like '%require_manager_club_scope_v1%') from funcs
 union all select 'retry_records_private',coalesce((select relrowsecurity and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') from pg_class where oid=to_regclass('public.manager_event_creation_requests')),false)
 union all select 'criteria_in_transaction',coalesce((select body like '%manager_sync_event_criteria_v1(v_event_id,p_criterion_ids)%' from funcs where proname='create_manager_events_v1'),false)
 union all select 'criteria_helper_available',to_regprocedure('public.manager_sync_event_criteria_v1(uuid,uuid[])') is not null
)
select check_name,case when ok then 'ok' else 'ERROR' end status from checks order by check_name;
