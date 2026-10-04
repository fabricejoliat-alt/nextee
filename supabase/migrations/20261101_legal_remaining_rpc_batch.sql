-- Apply once after 20261031 on isolated TEST. No activation and no data backfill.
-- Preserve public RPC signatures; delegate to unchanged business functions.
-- Creation batch has only a platform guard here; its nested event creation checks group scope.
-- Event-thread functions also run inside SECURITY DEFINER triggers; those internal calls delegate unchanged.
begin;

alter function public.copy_manager_event_structure_v1(uuid,jsonb) rename to copy_manager_event_structure_v1_business;
revoke all on function public.copy_manager_event_structure_v1_business(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.copy_manager_event_structure_v1_business(uuid,jsonb) to service_role;
create function public.copy_manager_event_structure_v1(p_event_id uuid,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.copy_manager_event_structure_v1_business(p_event_id,p_expected);
end $$;
revoke all on function public.copy_manager_event_structure_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.copy_manager_event_structure_v1(uuid,jsonb) to authenticated,service_role;

alter function public.get_manager_competition_snapshot_v1(uuid) rename to get_manager_competition_snapshot_v1_business;
revoke all on function public.get_manager_competition_snapshot_v1_business(uuid) from public,anon,authenticated;
grant execute on function public.get_manager_competition_snapshot_v1_business(uuid) to service_role;
create function public.get_manager_competition_snapshot_v1(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.get_manager_competition_snapshot_v1_business(p_event_id);
end $$;
revoke all on function public.get_manager_competition_snapshot_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_manager_competition_snapshot_v1(uuid) to authenticated,service_role;

alter function public.get_manager_evaluation_snapshot_v1(uuid,uuid) rename to get_manager_evaluation_snapshot_v1_business;
revoke all on function public.get_manager_evaluation_snapshot_v1_business(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_manager_evaluation_snapshot_v1_business(uuid,uuid) to service_role;
create function public.get_manager_evaluation_snapshot_v1(p_event_id uuid,p_player_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.get_manager_evaluation_snapshot_v1_business(p_event_id,p_player_id);
end $$;
revoke all on function public.get_manager_evaluation_snapshot_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_manager_evaluation_snapshot_v1(uuid,uuid) to authenticated,service_role;

alter function public.get_manager_planning_snapshot_v1(uuid) rename to get_manager_planning_snapshot_v1_business;
revoke all on function public.get_manager_planning_snapshot_v1_business(uuid) from public,anon,authenticated;
grant execute on function public.get_manager_planning_snapshot_v1_business(uuid) to service_role;
create function public.get_manager_planning_snapshot_v1(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.get_manager_planning_snapshot_v1_business(p_event_id);
end $$;
revoke all on function public.get_manager_planning_snapshot_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_manager_planning_snapshot_v1(uuid) to authenticated,service_role;

alter function public.save_manager_competition_v1(uuid,jsonb,jsonb) rename to save_manager_competition_v1_business;
revoke all on function public.save_manager_competition_v1_business(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_manager_competition_v1_business(uuid,jsonb,jsonb) to service_role;
create function public.save_manager_competition_v1(p_event_id uuid,p_expected jsonb,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.save_manager_competition_v1_business(p_event_id,p_expected,p_payload);
end $$;
revoke all on function public.save_manager_competition_v1(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_manager_competition_v1(uuid,jsonb,jsonb) to authenticated,service_role;

alter function public.save_manager_event_feedback_v1(uuid,uuid,jsonb) rename to save_manager_event_feedback_v1_business;
revoke all on function public.save_manager_event_feedback_v1_business(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_manager_event_feedback_v1_business(uuid,uuid,jsonb) to service_role;
create function public.save_manager_event_feedback_v1(p_event_id uuid,p_player_id uuid,p_feedback jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  perform public.save_manager_event_feedback_v1_business(p_event_id,p_player_id,p_feedback);
  return;
end $$;
revoke all on function public.save_manager_event_feedback_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_manager_event_feedback_v1(uuid,uuid,jsonb) to authenticated,service_role;

alter function public.save_manager_event_feedback_v2(uuid,uuid,jsonb,jsonb) rename to save_manager_event_feedback_v2_business;
revoke all on function public.save_manager_event_feedback_v2_business(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_manager_event_feedback_v2_business(uuid,uuid,jsonb,jsonb) to service_role;
create function public.save_manager_event_feedback_v2(p_event_id uuid,p_player_id uuid,p_expected jsonb,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.save_manager_event_feedback_v2_business(p_event_id,p_player_id,p_expected,p_values);
end $$;
revoke all on function public.save_manager_event_feedback_v2(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_manager_event_feedback_v2(uuid,uuid,jsonb,jsonb) to authenticated,service_role;

alter function public.get_manager_om_data_v1(uuid,text) rename to get_manager_om_data_v1_business;
revoke all on function public.get_manager_om_data_v1_business(uuid,text) from public,anon,authenticated;
grant execute on function public.get_manager_om_data_v1_business(uuid,text) to service_role;
create function public.get_manager_om_data_v1(p_club_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access(p_club_id) is not true then raise exception 'Legal validation required'; end if;
  return public.get_manager_om_data_v1_business(p_club_id,p_kind);
end $$;
revoke all on function public.get_manager_om_data_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.get_manager_om_data_v1(uuid,text) to authenticated,service_role;

alter function public.get_manager_om_contest_v1(uuid) rename to get_manager_om_contest_v1_business;
revoke all on function public.get_manager_om_contest_v1_business(uuid) from public,anon,authenticated;
grant execute on function public.get_manager_om_contest_v1_business(uuid) to service_role;
create function public.get_manager_om_contest_v1(p_contest_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access((select organization_id from public.om_internal_contests where id=p_contest_id)) is not true then raise exception 'Legal validation required'; end if;
  return public.get_manager_om_contest_v1_business(p_contest_id);
end $$;
revoke all on function public.get_manager_om_contest_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_manager_om_contest_v1(uuid) to authenticated,service_role;

alter function public.get_manager_om_ranking_v1(uuid,date,date,uuid) rename to get_manager_om_ranking_v1_business;
revoke all on function public.get_manager_om_ranking_v1_business(uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function public.get_manager_om_ranking_v1_business(uuid,date,date,uuid) to service_role;
create function public.get_manager_om_ranking_v1(p_club_id uuid,p_from date,p_to date,p_player_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access(p_club_id) is not true then raise exception 'Legal validation required'; end if;
  return public.get_manager_om_ranking_v1_business(p_club_id,p_from,p_to,p_player_id);
end $$;
revoke all on function public.get_manager_om_ranking_v1(uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function public.get_manager_om_ranking_v1(uuid,date,date,uuid) to authenticated,service_role;

alter function public.ensure_event_thread_for_event(uuid) rename to ensure_event_thread_for_event_business;
revoke all on function public.ensure_event_thread_for_event_business(uuid) from public,anon,authenticated;
grant execute on function public.ensure_event_thread_for_event_business(uuid) to service_role;
create function public.ensure_event_thread_for_event(p_event_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if pg_trigger_depth()=0 and public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.ensure_event_thread_for_event_business(p_event_id);
end $$;
revoke all on function public.ensure_event_thread_for_event(uuid) from public,anon,authenticated;
grant execute on function public.ensure_event_thread_for_event(uuid) to authenticated,service_role;

alter function public.sync_event_thread_participants(uuid) rename to sync_event_thread_participants_business;
revoke all on function public.sync_event_thread_participants_business(uuid) from public,anon,authenticated;
grant execute on function public.sync_event_thread_participants_business(uuid) to service_role;
create function public.sync_event_thread_participants(p_event_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if pg_trigger_depth()=0 and public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  perform public.sync_event_thread_participants_business(p_event_id);
  return;
end $$;
revoke all on function public.sync_event_thread_participants(uuid) from public,anon,authenticated;
grant execute on function public.sync_event_thread_participants(uuid) to authenticated,service_role;

alter function public.start_rules_quiz(uuid,uuid) rename to start_rules_quiz_business;
revoke all on function public.start_rules_quiz_business(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_rules_quiz_business(uuid,uuid) to service_role;
create function public.start_rules_quiz(p_series_id uuid,p_club_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access(p_club_id) is not true then raise exception 'Legal validation required'; end if;
  return public.start_rules_quiz_business(p_series_id,p_club_id);
end $$;
revoke all on function public.start_rules_quiz(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_rules_quiz(uuid,uuid) to authenticated,service_role;

alter function public.submit_rules_quiz(uuid) rename to submit_rules_quiz_business;
revoke all on function public.submit_rules_quiz_business(uuid) from public,anon,authenticated;
grant execute on function public.submit_rules_quiz_business(uuid) to service_role;
create function public.submit_rules_quiz(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access((select club_id from public.rules_quiz_attempts where id=p_attempt_id)) is not true then raise exception 'Legal validation required'; end if;
  return public.submit_rules_quiz_business(p_attempt_id);
end $$;
revoke all on function public.submit_rules_quiz(uuid) from public,anon,authenticated;
grant execute on function public.submit_rules_quiz(uuid) to authenticated,service_role;

alter function public.create_manager_activity_batch_v1(uuid,jsonb) rename to create_manager_activity_batch_v1_business;
revoke all on function public.create_manager_activity_batch_v1_business(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_manager_activity_batch_v1_business(uuid,jsonb) to service_role;
create function public.create_manager_activity_batch_v1(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access() is not true then raise exception 'Legal validation required'; end if;
  return public.create_manager_activity_batch_v1_business(p_request_id,p_payload);
end $$;
revoke all on function public.create_manager_activity_batch_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_manager_activity_batch_v1(uuid,jsonb) to authenticated,service_role;

alter function public.coach_group_delete_category(uuid,uuid) rename to coach_group_delete_category_business;
revoke all on function public.coach_group_delete_category_business(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_group_delete_category_business(uuid,uuid) to service_role;
create function public.coach_group_delete_category(p_group_id uuid,p_category_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_group_access(p_group_id) is not true then raise exception 'Legal validation required'; end if;
  perform public.coach_group_delete_category_business(p_group_id,p_category_id);
  return;
end $$;
revoke all on function public.coach_group_delete_category(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_group_delete_category(uuid,uuid) to authenticated,service_role;

alter function public.coach_group_delete_player(uuid,uuid) rename to coach_group_delete_player_business;
revoke all on function public.coach_group_delete_player_business(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_group_delete_player_business(uuid,uuid) to service_role;
create function public.coach_group_delete_player(p_group_id uuid,p_group_player_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_group_access(p_group_id) is not true then raise exception 'Legal validation required'; end if;
  perform public.coach_group_delete_player_business(p_group_id,p_group_player_id);
  return;
end $$;
revoke all on function public.coach_group_delete_player(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_group_delete_player(uuid,uuid) to authenticated,service_role;

alter function public.answer_rules_quiz_question(uuid,uuid,uuid[]) rename to answer_rules_quiz_question_business;
revoke all on function public.answer_rules_quiz_question_business(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.answer_rules_quiz_question_business(uuid,uuid,uuid[]) to service_role;
create function public.answer_rules_quiz_question(p_attempt_id uuid,p_question_id uuid,p_option_ids uuid[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access((select club_id from public.rules_quiz_attempts where id=p_attempt_id)) is not true then raise exception 'Legal validation required'; end if;
  perform public.answer_rules_quiz_question_business(p_attempt_id,p_question_id,p_option_ids);
  return;
end $$;
revoke all on function public.answer_rules_quiz_question(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.answer_rules_quiz_question(uuid,uuid,uuid[]) to authenticated,service_role;

alter function public.get_rules_quiz_question(uuid,smallint) rename to get_rules_quiz_question_business;
revoke all on function public.get_rules_quiz_question_business(uuid,smallint) from public,anon,authenticated;
grant execute on function public.get_rules_quiz_question_business(uuid,smallint) to service_role;
create function public.get_rules_quiz_question(p_attempt_id uuid,p_position smallint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access((select club_id from public.rules_quiz_attempts where id=p_attempt_id)) is not true then raise exception 'Legal validation required'; end if;
  return public.get_rules_quiz_question_business(p_attempt_id,p_position);
end $$;
revoke all on function public.get_rules_quiz_question(uuid,smallint) from public,anon,authenticated;
grant execute on function public.get_rules_quiz_question(uuid,smallint) to authenticated,service_role;

alter function public.get_rules_quiz_result(uuid) rename to get_rules_quiz_result_business;
revoke all on function public.get_rules_quiz_result_business(uuid) from public,anon,authenticated;
grant execute on function public.get_rules_quiz_result_business(uuid) to service_role;
create function public.get_rules_quiz_result(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access((select club_id from public.rules_quiz_attempts where id=p_attempt_id)) is not true then raise exception 'Legal validation required'; end if;
  return public.get_rules_quiz_result_business(p_attempt_id);
end $$;
revoke all on function public.get_rules_quiz_result(uuid) from public,anon,authenticated;
grant execute on function public.get_rules_quiz_result(uuid) to authenticated,service_role;

-- These helpers are used by privileged paths, not called from the browser.
revoke all on function public.om_sync_bonus_for_attendee(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.om_sync_bonus_for_attendee(uuid,uuid,text) to service_role;

alter function public.etiquette_publish_theme(uuid) rename to etiquette_publish_theme_business;
revoke all on function public.etiquette_publish_theme_business(uuid) from public,anon,authenticated;
grant execute on function public.etiquette_publish_theme_business(uuid) to service_role;
create function public.etiquette_publish_theme(p_theme_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access() is not true then raise exception 'Legal validation required'; end if;
  perform public.etiquette_publish_theme_business(p_theme_id);
  return;
end $$;
revoke all on function public.etiquette_publish_theme(uuid) from public,anon,authenticated;
grant execute on function public.etiquette_publish_theme(uuid) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
