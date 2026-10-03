-- Read-only: expected 6 rows with ok=true.
with target as (
  select to_regprocedure('public.remove_manager_parent_v1(uuid,uuid,uuid,uuid[],uuid[])') as id
)
select '01 parent removal installed' as check_name, id is not null as ok from target
union all select '02 server-only execution', coalesce(has_function_privilege('service_role',id,'EXECUTE')
  and not has_function_privilege('anon',id,'EXECUTE') and not has_function_privilege('authenticated',id,'EXECUTE'),false) from target
union all select '03 security definer with fixed path', coalesce((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=id),false) from target
union all select '04 guardian membership roles', exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_members' and column_name='role')
union all select '05 invitation revocation columns', count(*)=3 from information_schema.columns
  where table_schema='public' and table_name='access_invitation_tokens' and column_name in ('recipient_user_id','consumed_at','invitation_kind')
union all select '06 report recipient cleanup columns', count(*)=3 from information_schema.columns
  where table_schema='public' and table_name='player_periodic_report_configs' and column_name in ('club_id','player_user_id','recipient_user_ids')
order by check_name;
