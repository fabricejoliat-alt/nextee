-- Read-only. TEST wizbeuuvjibmmuxyynly; run before 20261103.
select 'inactive_control' item, (select enabled from public.legal_enforcement_control where singleton) is false ok
union all select 'no_active_documents',not exists(select 1 from public.legal_documents where active)
union all select 'legal_required_direct_access(uuid)',md5(pg_get_functiondef(to_regprocedure('public.legal_required_direct_access(uuid)')))='155b5f5c5d5d0762ed85245b0d23a1b4'
union all select 'staff_seed_group_players_attendees(uuid)',md5(pg_get_functiondef(to_regprocedure('public.staff_seed_group_players_attendees(uuid)')))='a0615e63c6c97c8c5286591186e3d2e7'
union all select 'create_player_golf_rounds_transactional(uuid,jsonb,timestamp with time zone[],jsonb)',md5(pg_get_functiondef(to_regprocedure('public.create_player_golf_rounds_transactional(uuid,jsonb,timestamp with time zone[],jsonb)')))='199fd7e14679c1927194288a71636f18'
union all select 'new helper club_training',to_regprocedure('public.legal_required_club_training_access(uuid)') is null
union all select 'new helper thread',to_regprocedure('public.legal_required_thread_access(uuid)') is null
union all select 'new helper round',to_regprocedure('public.legal_required_round_access(uuid)') is null
union all select 'new helper contest',to_regprocedure('public.legal_required_contest_access(uuid)') is null
union all select 'RLS club_evaluation_criteria',(select relrowsecurity from pg_class where oid='public.club_evaluation_criteria'::regclass)
union all select 'RLS club_event_series',(select relrowsecurity from pg_class where oid='public.club_event_series'::regclass)
union all select 'RLS club_news',(select relrowsecurity from pg_class where oid='public.club_news'::regclass)
union all select 'RLS club_seasons',(select relrowsecurity from pg_class where oid='public.club_seasons'::regclass)
union all select 'RLS club_trainings',(select relrowsecurity from pg_class where oid='public.club_trainings'::regclass)
union all select 'RLS coach_player_group_transfers',(select relrowsecurity from pg_class where oid='public.coach_player_group_transfers'::regclass)
union all select 'RLS coach_players',(select relrowsecurity from pg_class where oid='public.coach_players'::regclass)
union all select 'RLS player_periodic_reports',(select relrowsecurity from pg_class where oid='public.player_periodic_reports'::regclass)
union all select 'RLS player_periodic_report_deliveries',(select relrowsecurity from pg_class where oid='public.player_periodic_report_deliveries'::regclass)
union all select 'RLS rules_club_participations',(select relrowsecurity from pg_class where oid='public.rules_club_participations'::regclass)
union all select 'RLS rules_quiz_attempts',(select relrowsecurity from pg_class where oid='public.rules_quiz_attempts'::regclass)
union all select 'RLS rules_rewards',(select relrowsecurity from pg_class where oid='public.rules_rewards'::regclass)
union all select 'RLS platform_news_clubs',(select relrowsecurity from pg_class where oid='public.platform_news_clubs'::regclass)
union all select 'RLS club_event_coaches',(select relrowsecurity from pg_class where oid='public.club_event_coaches'::regclass)
union all select 'RLS club_event_evaluation_criteria',(select relrowsecurity from pg_class where oid='public.club_event_evaluation_criteria'::regclass)
union all select 'RLS club_event_evaluation_responses',(select relrowsecurity from pg_class where oid='public.club_event_evaluation_responses'::regclass)
union all select 'RLS club_event_player_structure_items',(select relrowsecurity from pg_class where oid='public.club_event_player_structure_items'::regclass)
union all select 'RLS club_event_structure_items',(select relrowsecurity from pg_class where oid='public.club_event_structure_items'::regclass)
union all select 'RLS coach_group_coaches',(select relrowsecurity from pg_class where oid='public.coach_group_coaches'::regclass)
union all select 'RLS coach_group_categories',(select relrowsecurity from pg_class where oid='public.coach_group_categories'::regclass)
union all select 'RLS rules_coach_coverage',(select relrowsecurity from pg_class where oid='public.rules_coach_coverage'::regclass)
union all select 'RLS message_threads',(select relrowsecurity from pg_class where oid='public.message_threads'::regclass)
union all select 'RLS player_dashboard_documents',(select relrowsecurity from pg_class where oid='public.player_dashboard_documents'::regclass)
union all select 'RLS thread_messages',(select relrowsecurity from pg_class where oid='public.thread_messages'::regclass)
union all select 'RLS thread_participants',(select relrowsecurity from pg_class where oid='public.thread_participants'::regclass)
union all select 'RLS player_activity_events',(select relrowsecurity from pg_class where oid='public.player_activity_events'::regclass)
union all select 'RLS player_handicap_history',(select relrowsecurity from pg_class where oid='public.player_handicap_history'::regclass)
union all select 'RLS rules_card_progress',(select relrowsecurity from pg_class where oid='public.rules_card_progress'::regclass)
union all select 'RLS om_bonus_entries',(select relrowsecurity from pg_class where oid='public.om_bonus_entries'::regclass)
union all select 'RLS om_exceptional_tournaments',(select relrowsecurity from pg_class where oid='public.om_exceptional_tournaments'::regclass)
union all select 'RLS om_internal_contests',(select relrowsecurity from pg_class where oid='public.om_internal_contests'::regclass)
union all select 'RLS om_tournament_scores',(select relrowsecurity from pg_class where oid='public.om_tournament_scores'::regclass)
union all select 'RLS om_internal_contest_results',(select relrowsecurity from pg_class where oid='public.om_internal_contest_results'::regclass)
union all select 'RLS golf_rounds',(select relrowsecurity from pg_class where oid='public.golf_rounds'::regclass)
union all select 'RLS golf_round_holes',(select relrowsecurity from pg_class where oid='public.golf_round_holes'::regclass)
union all select 'RLS club_training_attendance',(select relrowsecurity from pg_class where oid='public.club_training_attendance'::regclass)
union all select 'RLS club_training_coach_evals',(select relrowsecurity from pg_class where oid='public.club_training_coach_evals'::regclass)

union all select 'fixture_memberships_inactive',not exists(select 1 from public.club_members where club_id in ('efa61978-72ac-47f0-b0e4-0b692191c2bb','e4e6fffc-7d98-4a32-a5aa-22b2e18f2c4a') and is_active)
union all select 'fixture_users_banned', (select count(*)=6 and bool_and(banned_until>now()) from auth.users where email like 'legalqa_20261004_9a282f.%@example.invalid')
union all select 'fixture_admin_removed',not exists(select 1 from public.app_admins where user_id='891caa14-8572-41fb-b4bb-ec151c5fcdac')
union all select 'fixture_group_inactive', (select is_active=false from public.coach_groups where id='eab5aa57-f25f-4b5d-81e2-408dea246ff2')
union all select 'fixture_event_cancelled',(select status='cancelled' from public.club_events where id='65a28d29-1c19-48ce-a07a-86dd81d5fddd')
union all select 'versions_unchanged',(select count(*)=4 from public.legal_versions)
union all select 'decisions_unchanged',(select count(*)=10 from public.legal_decisions)
order by item;
