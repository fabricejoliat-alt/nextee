-- Apply after 20261024 on isolated TEST. Legal enforcement remains constrained OFF.
-- Preserve the existing transactional golf logic while guarding client entry points.
begin;

alter function public.om_recompute_round(uuid) rename to om_recompute_round_business;
revoke all on function public.om_recompute_round_business(uuid) from public,anon,authenticated;
grant execute on function public.om_recompute_round_business(uuid) to service_role;
create function public.om_recompute_round(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); owner_id uuid; club uuid;
begin
  -- Existing score triggers call this name after a row write. Their write policy
  -- already governs the row; service-role jobs retain their existing path.
  if auth.role()='service_role' or session_user='postgres' or pg_trigger_depth()>0 then
    return public.om_recompute_round_business(p_round_id);
  end if;
  select r.user_id,r.om_organization_id into owner_id,club
    from public.golf_rounds r where r.id=p_round_id;
  if not found or actor is null or not (
    actor=owner_id or exists(select 1 from public.player_guardians g
      where g.player_id=owner_id and g.guardian_user_id=actor
        and coalesce(g.can_view,true) and coalesce(g.can_edit,false))
  ) then raise exception 'Forbidden'; end if;
  if public.legal_required_direct_access(club) is not true then raise exception 'Legal validation required'; end if;
  return public.om_recompute_round_business(p_round_id);
end $$;
revoke all on function public.om_recompute_round(uuid) from public,anon,authenticated;
grant execute on function public.om_recompute_round(uuid) to authenticated,service_role;

alter function public.save_player_golf_hole_transactional(uuid,jsonb)
  rename to save_player_golf_hole_transactional_business;
revoke all on function public.save_player_golf_hole_transactional_business(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.save_player_golf_hole_transactional_business(uuid,jsonb) to service_role;
create function public.save_player_golf_hole_transactional(p_round_id uuid,p_hole jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare club uuid;
begin
  select om_organization_id into club from public.golf_rounds where id=p_round_id;
  if public.legal_required_direct_access(club) is not true then raise exception 'Legal validation required'; end if;
  return public.save_player_golf_hole_transactional_business(p_round_id,p_hole);
end $$;
revoke all on function public.save_player_golf_hole_transactional(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_player_golf_hole_transactional(uuid,jsonb) to authenticated,service_role;

alter function public.save_player_golf_holes_transactional(uuid,jsonb)
  rename to save_player_golf_holes_transactional_business;
revoke all on function public.save_player_golf_holes_transactional_business(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.save_player_golf_holes_transactional_business(uuid,jsonb) to service_role;
create function public.save_player_golf_holes_transactional(p_round_id uuid,p_holes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare club uuid;
begin
  select om_organization_id into club from public.golf_rounds where id=p_round_id;
  if public.legal_required_direct_access(club) is not true then raise exception 'Legal validation required'; end if;
  return public.save_player_golf_holes_transactional_business(p_round_id,p_holes);
end $$;
revoke all on function public.save_player_golf_holes_transactional(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_player_golf_holes_transactional(uuid,jsonb) to authenticated,service_role;

alter function public.update_player_golf_round_transactional(
  uuid,timestamptz,text,text,smallint,text,integer,numeric,integer,jsonb)
  rename to update_player_golf_round_transactional_business;
revoke all on function public.update_player_golf_round_transactional_business(
  uuid,timestamptz,text,text,smallint,text,integer,numeric,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.update_player_golf_round_transactional_business(
  uuid,timestamptz,text,text,smallint,text,integer,numeric,integer,jsonb) to service_role;
create function public.update_player_golf_round_transactional(
  p_round_id uuid,p_start_at timestamptz,p_notes text,p_competition_level text,
  p_rounds_18_count smallint,p_tee_name text,p_slope_rating integer,p_course_rating numeric,
  p_target_hole_count integer,p_holes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare club uuid;
begin
  select om_organization_id into club from public.golf_rounds where id=p_round_id;
  if public.legal_required_direct_access(club) is not true then raise exception 'Legal validation required'; end if;
  return public.update_player_golf_round_transactional_business(p_round_id,p_start_at,p_notes,
    p_competition_level,p_rounds_18_count,p_tee_name,p_slope_rating,p_course_rating,
    p_target_hole_count,p_holes);
end $$;
revoke all on function public.update_player_golf_round_transactional(
  uuid,timestamptz,text,text,smallint,text,integer,numeric,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.update_player_golf_round_transactional(
  uuid,timestamptz,text,text,smallint,text,integer,numeric,integer,jsonb) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
