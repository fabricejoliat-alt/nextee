-- Read-only checks. No contest, result, bonus or tournament is changed.
with funcs as (
 select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_manager_om_data_v1','get_manager_om_contest_v1','write_manager_om_v1','get_manager_om_ranking_v1')
), checks as (
 select 'catalog_exists' check_name,to_regprocedure('public.get_manager_om_data_v1(uuid,text)') is not null ok
 union all select 'contest_snapshot_exists',to_regprocedure('public.get_manager_om_contest_v1(uuid)') is not null
 union all select 'ranking_exists',to_regprocedure('public.get_manager_om_ranking_v1(uuid,date,date,uuid)') is not null
 union all select 'write_exists',to_regprocedure('public.write_manager_om_v1(uuid,uuid,text,text,uuid,text,jsonb)') is not null
 union all select 'security_definer',count(*)=4 and bool_and(prosecdef) from funcs
 union all select 'fixed_search_paths',count(*)=4 and bool_and('search_path=""'=any(proconfig)) from funcs
 union all select 'anonymous_denied',count(*)=4 and bool_and(not has_function_privilege('anon',oid,'EXECUTE')) from funcs
 union all select 'authenticated_allowed',count(*)=4 and bool_and(has_function_privilege('authenticated',oid,'EXECUTE')) from funcs
 union all select 'manager_scope',count(*)=4 and bool_and(body like '%require_manager_club_scope_v1%') from funcs
 union all select 'ledger_rls',coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.manager_om_write_requests')),false)
 union all select 'ledger_client_denied',not has_table_privilege('authenticated','public.manager_om_write_requests','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.manager_om_write_requests','SELECT,INSERT,UPDATE,DELETE')
 union all select 'old_publisher_denied',not has_function_privilege('authenticated','public.om_publish_internal_contest(uuid,jsonb,jsonb)','EXECUTE') and not has_function_privilege('anon','public.om_publish_internal_contest(uuid,jsonb,jsonb)','EXECUTE')
 union all select 'direct_writes_denied',bool_and(not has_table_privilege('authenticated',name,'INSERT,UPDATE,DELETE') and not has_table_privilege('anon',name,'INSERT,UPDATE,DELETE')) from unnest(array['public.om_internal_contests','public.om_internal_contest_results','public.om_exceptional_tournaments']) name
 union all select 'podium_policies',count(*)=3 and bool_and(not polpermissive) from pg_policy where polrelid='public.om_bonus_entries'::regclass and polname in ('manager_om_podium_insert','manager_om_podium_update','manager_om_podium_delete')
 union all select 'retry_and_concurrency_guards',coalesce((select body like '%request_conflict%' and body like '%replayed%' and body like '%om_conflict%' and body like '%for update%' from funcs where proname='write_manager_om_v1'),false)
 union all select 'referenced_tournaments_preserved',coalesce((select body like '%tournament_in_use%' and body like '%om_exceptional_tournament_id=p_id%' from funcs where proname='write_manager_om_v1'),false)
 union all select 'version_helper_private',not has_function_privilege('authenticated','public.manager_om_contest_version_v1(uuid)','EXECUTE') and not has_function_privilege('anon','public.manager_om_contest_version_v1(uuid)','EXECUTE')
)
select check_name,case when ok then 'ok' else 'ERROR' end status from checks order by check_name;
