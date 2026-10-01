-- All dependency cleanup is committed together. Only authenticated server routes
-- may supply the actor; browser roles cannot call this service-only function.
begin;
create or replace function public.delete_coach_planning_v1(
  p_actor_id uuid, p_event_id uuid default null, p_series_id uuid default null,
  p_occurrence_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event public.club_events%rowtype;
  v_series public.club_event_series%rowtype;
  v_group uuid;
  v_club uuid;
  v_ids uuid[];
  v_recipients uuid[];
  v_notifications jsonb;
  v_table text;
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_id is null then
    raise exception 'forbidden';
  end if;
  if (p_event_id is null) = (p_series_id is null) then raise exception 'invalid_delete_scope'; end if;
  if p_series_id is not null then
    select * into v_series from public.club_event_series where id = p_series_id for update;
    if not found then raise exception 'series_not_found'; end if;
    v_group := v_series.group_id; v_club := v_series.club_id;
  else
    select * into v_event from public.club_events where id = p_event_id for update;
    if not found then raise exception 'event_not_found'; end if;
    v_group := v_event.group_id; v_club := v_event.club_id;
  end if;
  if v_group is null or v_club is null or not exists (
    select 1 from public.coach_groups where id = v_group and club_id = v_club
  ) or not public.can_manage_assigned_group(v_group, p_actor_id, 'planning') then
    raise exception 'forbidden';
  end if;
  if p_event_id is not null and v_event.series_id is not null and not coalesce(p_occurrence_confirmed,false) then
    raise exception 'occurrence_confirmation_required';
  end if;
  -- Lock the complete set, never a paginated browser snapshot. Foreign or
  -- manager-only occurrences make the whole request fail before any deletion.
  perform id from public.club_events where
    (p_series_id is not null and series_id = p_series_id) or id = p_event_id order by id for update;
  if exists (select 1 from public.club_events where
    ((p_series_id is not null and series_id = p_series_id) or id = p_event_id)
    and (group_id is distinct from v_group or club_id is distinct from v_club or event_type = 'competition')
  ) then raise exception 'forbidden'; end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]),
    coalesce(jsonb_agg(jsonb_build_object('id',id,'event_type',event_type,'starts_at',starts_at,
      'location_text',location_text) order by starts_at,id), '[]'::jsonb)
  into v_ids,v_notifications from public.club_events where
    (p_series_id is not null and series_id = p_series_id) or id = p_event_id;
  select coalesce(array_agg(distinct player_id), '{}'::uuid[]) into v_recipients
    from public.club_event_attendees where event_id = any(v_ids) and coalesce(status,'expected') <> 'absent';
  foreach v_table in array array['club_event_attendees','club_event_coaches','club_event_structure_items',
    'club_event_player_structure_items','club_event_player_feedback','club_event_coach_feedback'] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('delete from public.%I where event_id = any($1)',v_table) using v_ids;
    end if;
  end loop;
  if to_regclass('public.training_sessions') is not null then
    if to_regclass('public.training_session_items') is not null then
      execute 'delete from public.training_session_items where session_id in (select id from public.training_sessions where club_event_id = any($1))' using v_ids;
    end if;
    execute 'delete from public.training_sessions where club_event_id = any($1)' using v_ids;
  end if;
  if to_regclass('public.message_threads') is not null then
    execute 'delete from public.message_threads where event_id = any($1)' using v_ids;
  end if;
  -- Other event-owned records follow their schema FK cascade; documents and
  -- linked club news retain their existing ON DELETE SET NULL behavior.
  delete from public.club_events where id = any(v_ids);
  if p_series_id is not null then delete from public.club_event_series where id = p_series_id; end if;
  return jsonb_build_object('ok',true,'deleted_event_id',p_event_id,'deleted_series_id',p_series_id,
    'deleted_events',cardinality(v_ids),'events',v_notifications,'recipient_ids',v_recipients);
end;
$$;
revoke all on function public.delete_coach_planning_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.delete_coach_planning_v1(uuid,uuid,uuid,boolean) to service_role;
commit;
