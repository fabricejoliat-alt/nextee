-- Read-only postflight after applying 20261109_seed_ftem_on_new_club.sql.
select 'ten_default_levels' as check_name,
  (select count(*) = 10 from public.training_volume_default_targets) as passed
union all
select 'default_codes',
  (select array_agg(ftem_code order by sort_order) =
    array['F1','F2','F3','T1','T2','T3','T4','E1','E2','M']::text[]
   from public.training_volume_default_targets)
union all
select 'trigger_installed',
  exists(select 1 from pg_trigger
    where tgname='seed_new_club_training_volume'
      and tgrelid='public.clubs'::regclass and not tgisinternal)
union all
select 'defaults_rls_enabled',
  (select relrowsecurity from pg_class
   where oid='public.training_volume_default_targets'::regclass)
union all
select 'client_write_closed',
  not has_table_privilege('anon','public.training_volume_default_targets','INSERT')
  and not has_table_privilege('anon','public.training_volume_default_targets','UPDATE')
  and not has_table_privilege('anon','public.training_volume_default_targets','DELETE')
  and not has_table_privilege('authenticated','public.training_volume_default_targets','INSERT')
  and not has_table_privilege('authenticated','public.training_volume_default_targets','UPDATE')
  and not has_table_privilege('authenticated','public.training_volume_default_targets','DELETE');
