-- Apply after 20261024 on isolated TEST. The legal control remains constrained to false.
-- Preserve the existing business checks in the original functions and gate their public entry points.
begin;

alter function public.create_coach_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)
  rename to create_coach_events_v1_business;
revoke all on function public.create_coach_events_v1_business(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)
  from public,anon,authenticated;
grant execute on function public.create_coach_events_v1_business(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb) to service_role;
create function public.create_coach_events_v1(
  p_request_id uuid,p_group_id uuid,p_mode text,p_template jsonb,
  p_coach_ids uuid[],p_player_ids uuid[],p_structure jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_group_access(p_group_id) is not true then raise exception 'Legal validation required'; end if;
  return public.create_coach_events_v1_business(p_request_id,p_group_id,p_mode,p_template,
    p_coach_ids,p_player_ids,p_structure);
end $$;
revoke all on function public.create_coach_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)
  from public,anon,authenticated;
grant execute on function public.create_coach_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)
  to authenticated,service_role;

alter function public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])
  rename to create_manager_events_v1_business;
revoke all on function public.create_manager_events_v1_business(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])
  from public,anon,authenticated;
grant execute on function public.create_manager_events_v1_business(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[]) to service_role;
create function public.create_manager_events_v1(
  p_request_id uuid,p_group_id uuid,p_mode text,p_template jsonb,
  p_coach_ids uuid[],p_player_ids uuid[],p_structure jsonb,p_criterion_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_group_access(p_group_id) is not true then raise exception 'Legal validation required'; end if;
  return public.create_manager_events_v1_business(p_request_id,p_group_id,p_mode,p_template,
    p_coach_ids,p_player_ids,p_structure,p_criterion_ids);
end $$;
revoke all on function public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])
  from public,anon,authenticated;
grant execute on function public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])
  to authenticated,service_role;

alter function public.create_player_golf_rounds_transactional(uuid,jsonb,timestamptz[],jsonb)
  rename to create_player_golf_rounds_transactional_business;
revoke all on function public.create_player_golf_rounds_transactional_business(uuid,jsonb,timestamptz[],jsonb)
  from public,anon,authenticated;
grant execute on function public.create_player_golf_rounds_transactional_business(uuid,jsonb,timestamptz[],jsonb) to service_role;
create function public.create_player_golf_rounds_transactional(
  p_player_id uuid,p_round_payload jsonb,p_round_dates timestamptz[],p_holes jsonb default '[]'::jsonb)
returns uuid[] language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access() is not true then raise exception 'Legal validation required'; end if;
  return public.create_player_golf_rounds_transactional_business(p_player_id,p_round_payload,p_round_dates,p_holes);
end $$;
revoke all on function public.create_player_golf_rounds_transactional(uuid,jsonb,timestamptz[],jsonb)
  from public,anon,authenticated;
grant execute on function public.create_player_golf_rounds_transactional(uuid,jsonb,timestamptz[],jsonb)
  to authenticated,service_role;

alter function public.set_player_performance_mode(uuid,uuid,boolean)
  rename to set_player_performance_mode_business;
revoke all on function public.set_player_performance_mode_business(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.set_player_performance_mode_business(uuid,uuid,boolean) to service_role;
create function public.set_player_performance_mode(p_org_id uuid,p_player_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access(p_org_id) is not true then raise exception 'Legal validation required'; end if;
  perform public.set_player_performance_mode_business(p_org_id,p_player_id,p_enabled);
end $$;
revoke all on function public.set_player_performance_mode(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.set_player_performance_mode(uuid,uuid,boolean) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
