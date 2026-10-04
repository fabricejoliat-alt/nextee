-- Apply after 20261024 on isolated TEST. Legal enforcement remains constrained OFF.
-- Keep the browser RPC names and delegate to unchanged Coach/Manager edit logic.
begin;

alter function public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)
  rename to update_coach_event_occurrence_v1_business;
revoke all on function public.update_coach_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)
  from public,anon,authenticated;
grant execute on function public.update_coach_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb) to service_role;
create function public.update_coach_event_occurrence_v1(
  p_event_id uuid,p_expected jsonb,p_changes jsonb,p_coach_ids uuid[],p_player_ids uuid[],p_structure jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.update_coach_event_occurrence_v1_business(p_event_id,p_expected,p_changes,
    p_coach_ids,p_player_ids,p_structure);
end $$;
revoke all on function public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)
  from public,anon,authenticated;
grant execute on function public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)
  to authenticated,service_role;

alter function public.update_coach_event_series_v1(uuid,jsonb,uuid[],uuid[],jsonb)
  rename to update_coach_event_series_v1_business;
revoke all on function public.update_coach_event_series_v1_business(uuid,jsonb,uuid[],uuid[],jsonb)
  from public,anon,authenticated;
grant execute on function public.update_coach_event_series_v1_business(uuid,jsonb,uuid[],uuid[],jsonb) to service_role;
create function public.update_coach_event_series_v1(
  p_source_event_id uuid,p_template jsonb,p_coach_ids uuid[],p_player_ids uuid[],p_structure jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_source_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.update_coach_event_series_v1_business(p_source_event_id,p_template,
    p_coach_ids,p_player_ids,p_structure);
end $$;
revoke all on function public.update_coach_event_series_v1(uuid,jsonb,uuid[],uuid[],jsonb)
  from public,anon,authenticated;
grant execute on function public.update_coach_event_series_v1(uuid,jsonb,uuid[],uuid[],jsonb)
  to authenticated,service_role;

alter function public.update_manager_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])
  rename to update_manager_event_occurrence_v1_business;
revoke all on function public.update_manager_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])
  from public,anon,authenticated;
grant execute on function public.update_manager_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[]) to service_role;
create function public.update_manager_event_occurrence_v1(
  p_event_id uuid,p_expected jsonb,p_changes jsonb,p_coach_ids uuid[],p_player_ids uuid[],
  p_structure jsonb,p_criterion_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.update_manager_event_occurrence_v1_business(p_event_id,p_expected,p_changes,
    p_coach_ids,p_player_ids,p_structure,p_criterion_ids);
end $$;
revoke all on function public.update_manager_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])
  from public,anon,authenticated;
grant execute on function public.update_manager_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])
  to authenticated,service_role;

alter function public.update_manager_event_series_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)
  rename to update_manager_event_series_v1_business;
revoke all on function public.update_manager_event_series_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)
  from public,anon,authenticated;
grant execute on function public.update_manager_event_series_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text) to service_role;
create function public.update_manager_event_series_v1(
  p_event_id uuid,p_expected jsonb,p_series jsonb,p_coach_ids uuid[],p_player_ids uuid[],
  p_structure jsonb,p_criterion_ids uuid[],p_timezone text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_event_access(p_event_id) is not true then raise exception 'Legal validation required'; end if;
  return public.update_manager_event_series_v1_business(p_event_id,p_expected,p_series,
    p_coach_ids,p_player_ids,p_structure,p_criterion_ids,p_timezone);
end $$;
revoke all on function public.update_manager_event_series_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)
  from public,anon,authenticated;
grant execute on function public.update_manager_event_series_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)
  to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
