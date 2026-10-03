-- Read-only: no participant, evaluation or notification is modified.
with funcs as (
 select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_manager_evaluation_snapshot_v1','save_manager_event_feedback_v2')
), checks as (
 select 'snapshot_exists' check_name,to_regprocedure('public.get_manager_evaluation_snapshot_v1(uuid,uuid)') is not null ok
 union all select 'save_exists',to_regprocedure('public.save_manager_event_feedback_v2(uuid,uuid,jsonb,jsonb)') is not null
 union all select 'dependencies_available',to_regprocedure('public.save_manager_event_feedback_v1(uuid,uuid,jsonb)') is not null and to_regprocedure('public.require_manager_club_scope_v1(uuid,uuid)') is not null
 union all select 'security_definer',count(*)=2 and bool_and(prosecdef) from funcs
 union all select 'fixed_search_paths',count(*)=2 and bool_and('search_path=""'=any(proconfig)) from funcs
 union all select 'anonymous_denied',count(*)=2 and bool_and(not has_function_privilege('anon',oid,'EXECUTE')) from funcs
 union all select 'authenticated_allowed',count(*)=2 and bool_and(has_function_privilege('authenticated',oid,'EXECUTE')) from funcs
 union all select 'manager_scope',count(*)=2 and bool_and(body like '%require_manager_club_scope_v1%') from funcs
 union all select 'concurrency_guard',coalesce((select body like '%v_snapshot is distinct from p_expected%' from funcs where proname='save_manager_event_feedback_v2'),false)
 union all select 'explicit_attendance',coalesce((select body like '%attendance_required%' and body like '%coach_recorded_at=clock_timestamp()%' from funcs where proname='save_manager_event_feedback_v2'),false)
 union all select 'criteria_validated',coalesce((select body like '%required_criteria_missing%' and body like '%invalid_custom_criterion%' from funcs where proname='save_manager_event_feedback_v2'),false)
)
select check_name,case when ok then 'ok' else 'ERROR' end status from checks order by check_name;
