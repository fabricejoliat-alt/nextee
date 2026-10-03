-- Read-only. These checks do not create or modify any activity.
with funcs as (
 select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_manager_activity_batch_v1','get_manager_competition_snapshot_v1','save_manager_competition_v1')
), checks as (
 select 'create_exists' check_name,to_regprocedure('public.create_manager_activity_batch_v1(uuid,jsonb)') is not null ok
 union all select 'snapshot_exists',to_regprocedure('public.get_manager_competition_snapshot_v1(uuid)') is not null
 union all select 'save_exists',to_regprocedure('public.save_manager_competition_v1(uuid,jsonb,jsonb)') is not null
 union all select 'dependencies_available',to_regprocedure('public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])') is not null and to_regprocedure('public.require_manager_club_scope_v1(uuid,uuid)') is not null
 union all select 'security_definer',count(*)=3 and bool_and(prosecdef) from funcs
 union all select 'fixed_search_paths',count(*)=3 and bool_and('search_path=""'=any(proconfig)) from funcs
 union all select 'anonymous_denied',count(*)=3 and bool_and(not has_function_privilege('anon',oid,'EXECUTE')) from funcs
 union all select 'authenticated_allowed',count(*)=3 and bool_and(has_function_privilege('authenticated',oid,'EXECUTE')) from funcs
 union all select 'manager_scope',count(*)=3 and bool_and(body like '%require_manager_club_scope_v1%') from funcs
 union all select 'ledger_rls',coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.manager_activity_creation_requests')),false)
 union all select 'ledger_client_denied',not has_table_privilege('authenticated','public.manager_activity_creation_requests','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.manager_activity_creation_requests','SELECT,INSERT,UPDATE,DELETE')
 union all select 'retry_guard',coalesce((select body like '%creation_request_conflict%' and body like '%replayed%' from funcs where proname='create_manager_activity_batch_v1'),false)
 union all select 'concurrency_guard',coalesce((select body like '%p_expected is distinct from v_snapshot%' and body like '%for update%' from funcs where proname='save_manager_competition_v1'),false)
 union all select 'history_preserved',coalesce((select body like '%evaluated_attendee_removal%' and body like '%on conflict(event_id,player_id) do nothing%' from funcs where proname='save_manager_competition_v1'),false)
 union all select 'validation_private',not has_function_privilege('authenticated','public.manager_validate_competition_v1(jsonb,boolean)','EXECUTE') and not has_function_privilege('anon','public.manager_validate_competition_v1(jsonb,boolean)','EXECUTE')
)
select check_name,case when ok then 'ok' else 'ERROR' end status from checks order by check_name;
