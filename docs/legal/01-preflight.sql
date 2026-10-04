-- Read-only. Run against the intended isolated TEST database before migration.
select current_database() as database_name, current_user as database_role, now() as checked_at;
select to_regclass('public.clubs') clubs, to_regclass('public.profiles') profiles,
  to_regclass('public.club_members') club_members, to_regclass('public.player_guardians') player_guardians,
  to_regclass('public.player_consent_history') legacy_history, to_regclass('public.app_admins') app_admins;
select (select count(*) from public.player_consent_history) as legacy_history_rows,
  (select count(*) from public.player_consents) as legacy_current_rows,
  (select count(*) from public.club_members where role='player' and is_active) as active_player_memberships;
select table_name, column_name, data_type from information_schema.columns where table_schema='public'
  and table_name in ('club_members','player_guardians','player_consent_history','app_admins')
  order by table_name, ordinal_position;
