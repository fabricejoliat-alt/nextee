-- Read-only checks, after applying 20261009 and 20261010 in this order.
-- Every ok value must be true. This does not replace save/reload UI validation.
with required(signature, client_rpc) as (values
  ('public.require_manager_club_scope_v1(uuid,uuid)',false),
  ('public.manager_event_snapshot_v1(uuid)',false),
  ('public.get_manager_planning_snapshot_v1(uuid)',true),
  ('public.manager_sync_event_criteria_v1(uuid,uuid[])',false),
  ('public.update_manager_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])',true),
  ('public.update_manager_event_series_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)',true),
  ('public.create_manager_season_v1(uuid,uuid,jsonb)',false),
  ('public.manager_camp_version_v1(uuid)',false),
  ('public.get_manager_camp_versions_v1(uuid,uuid[],uuid)',false),
  ('public.save_manager_camp_v1(uuid,uuid,uuid,text,jsonb)',false)
), checks as (
  select r.signature, p.oid is not null and p.prosecdef
    and not coalesce(has_function_privilege('anon',p.oid,'execute'),true)
    and coalesce(has_function_privilege('authenticated',p.oid,'execute'),false)=r.client_rpc
    and exists(select 1 from unnest(p.proconfig) setting where setting like 'search_path=%') as ok
  from required r left join pg_proc p on p.oid=to_regprocedure(r.signature)
)
select signature as check_name,ok from checks
union all select 'Coach occurrence transaction dependency',to_regprocedure('public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)') is not null
union all select 'Season group-copy trigger',exists(select 1 from pg_trigger where tgrelid='public.club_seasons'::regclass and tgname='copy_groups_to_new_season' and tgenabled='O')
union all select 'Server camp execution',coalesce(has_function_privilege('service_role',to_regprocedure('public.save_manager_camp_v1(uuid,uuid,uuid,text,jsonb)'),'execute'),false)
union all select 'Server season execution',coalesce(has_function_privilege('service_role',to_regprocedure('public.create_manager_season_v1(uuid,uuid,jsonb)'),'execute'),false)
order by check_name;
