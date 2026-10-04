-- Apply after 20261024 on isolated TEST. The legal control remains constrained OFF.
-- Guard two browser-callable Manager mutations without changing their business logic.
begin;

alter function public.coach_group_delete_keep_history(uuid)
  rename to coach_group_delete_keep_history_business;
revoke all on function public.coach_group_delete_keep_history_business(uuid)
  from public,anon,authenticated;
grant execute on function public.coach_group_delete_keep_history_business(uuid) to service_role;
create function public.coach_group_delete_keep_history(p_group_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_group_access(p_group_id) is not true then raise exception 'Legal validation required'; end if;
  perform public.coach_group_delete_keep_history_business(p_group_id);
end $$;
revoke all on function public.coach_group_delete_keep_history(uuid)
  from public,anon,authenticated;
grant execute on function public.coach_group_delete_keep_history(uuid) to authenticated,service_role;

alter function public.write_manager_om_v1(uuid,uuid,text,text,uuid,text,jsonb)
  rename to write_manager_om_v1_business;
revoke all on function public.write_manager_om_v1_business(uuid,uuid,text,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.write_manager_om_v1_business(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
create function public.write_manager_om_v1(
  p_request_id uuid,p_club_id uuid,p_kind text,p_action text,p_id uuid,p_expected text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access(p_club_id) is not true then raise exception 'Legal validation required'; end if;
  return public.write_manager_om_v1_business(p_request_id,p_club_id,p_kind,p_action,p_id,p_expected,p_payload);
end $$;
revoke all on function public.write_manager_om_v1(uuid,uuid,text,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.write_manager_om_v1(uuid,uuid,text,text,uuid,text,jsonb)
  to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
