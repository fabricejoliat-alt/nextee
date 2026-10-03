-- Atomic, retry-safe Manager activity creation, including selected attendees and criteria.
-- Requires the Manager scope and criteria helpers from 20261009.
begin;
create table if not exists public.manager_event_creation_requests (
  actor_id uuid not null,
  request_id uuid not null,
  group_id uuid not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table public.manager_event_creation_requests enable row level security;
revoke all on public.manager_event_creation_requests from public,anon,authenticated;

create or replace function public.create_manager_events_v1(
  p_request_id uuid, p_group_id uuid, p_mode text, p_template jsonb,
  p_coach_ids uuid[], p_player_ids uuid[], p_structure jsonb, p_criterion_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_group public.coach_groups%rowtype;
  v_request public.manager_event_creation_requests%rowtype;
  v_payload jsonb;
  v_type text := p_template->>'event_type';
  v_duration int := (p_template->>'duration_minutes')::int;
  v_start timestamptz;
  v_end timestamptz;
  v_start_date date;
  v_end_date date;
  v_weekday int;
  v_interval int;
  v_time time;
  v_day date;
  v_dates timestamptz[] := '{}';
  v_event_ids uuid[] := '{}';
  v_event_id uuid;
  v_series_id uuid;
  v_item jsonb;
  v_position int;
  v_result jsonb;
begin
  select * into v_group from public.coach_groups where id=p_group_id;
  if v_group.id is null then raise exception 'forbidden'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),v_group.club_id);
  if jsonb_typeof(p_template) is distinct from 'object' then raise exception 'invalid_event'; end if;
  if p_criterion_ids is null or cardinality(p_criterion_ids)>3
    or (cardinality(p_criterion_ids)>0 and (v_type not in ('training','camp') or not coalesce((p_template->>'requires_evaluation')::boolean,false)))
    then raise exception 'invalid_criteria'; end if;
  if p_request_id is null then raise exception 'invalid_request'; end if;
  v_payload := jsonb_build_object('group_id',p_group_id,'mode',p_mode,'template',p_template,
    'coach_ids',to_jsonb(p_coach_ids),'player_ids',to_jsonb(p_player_ids),'structure',p_structure,'criterion_ids',to_jsonb(p_criterion_ids));
  -- A concurrent/retried call waits here and then receives exactly the same IDs.
  insert into public.manager_event_creation_requests(actor_id,request_id,group_id,payload)
    values(auth.uid(),p_request_id,p_group_id,v_payload) on conflict(actor_id,request_id) do nothing;
  select * into v_request from public.manager_event_creation_requests
    where actor_id=auth.uid() and request_id=p_request_id for update;
  if v_request.payload is distinct from v_payload then raise exception 'creation_request_conflict'; end if;
  if v_request.result is not null then return v_request.result || jsonb_build_object('replayed',true); end if;

  if p_mode is null or p_mode not in ('single','series') or v_type is null
    or v_type not in ('training','interclub','camp','session','event') or v_duration is null
    or v_duration not between 1 and 300 then raise exception 'invalid_event'; end if;
  if v_type in ('camp','session','event') and nullif(btrim(p_template->>'title'),'') is null then raise exception 'title_required'; end if;
  if length(coalesce(p_template->>'title',''))>500 or length(coalesce(p_template->>'location_text',''))>2000
    or length(coalesce(p_template->>'coach_note',''))>10000 then raise exception 'invalid_event'; end if;
  if p_coach_ids is null or p_player_ids is null or cardinality(p_coach_ids)>500 or cardinality(p_player_ids)>2000
    or jsonb_typeof(p_structure) is distinct from 'array' or jsonb_array_length(p_structure)>100 then raise exception 'invalid_assignments'; end if;
  if exists(select 1 from unnest(p_coach_ids) u(id) where not exists(select 1 from public.club_members m
      where m.club_id=v_group.club_id and m.user_id=u.id and m.is_active and m.role in ('coach','manager')))
    or exists(select 1 from unnest(p_player_ids) u(id) where not exists(select 1 from public.club_members m
      where m.club_id=v_group.club_id and m.user_id=u.id and m.is_active)) then raise exception 'invalid_assignments'; end if;
  for v_item in select * from jsonb_array_elements(p_structure) loop
    if v_item->>'category' is null or v_item->>'category' not in
      ('warmup_mobility','long_game','short_game_all','putting','wedging','pitching','chipping','bunker','course','mental','fitness','other')
      or (v_item->>'minutes')::int is null or (v_item->>'minutes')::int not between 1 and 300
      or length(coalesce(v_item->>'note',''))>10000 then raise exception 'invalid_structure'; end if;
  end loop;
  if p_mode='single' then
    v_start := (p_template->>'starts_at')::timestamptz;
    v_end := (p_template->>'ends_at')::timestamptz;
    if v_start is null or v_end is null or v_end<=v_start
      or v_duration<>least(300,round(extract(epoch from (v_end-v_start))/60)::int) then raise exception 'invalid_event'; end if;
    v_dates := array[v_start];
  else
    v_start_date := (p_template->>'start_date')::date;
    v_end_date := (p_template->>'end_date')::date;
    v_weekday := (p_template->>'weekday')::int;
    v_interval := (p_template->>'interval_weeks')::int;
    v_time := (p_template->>'time_of_day')::time;
    if v_start_date is null or v_end_date is null or v_end_date<v_start_date or v_end_date-v_start_date>1827
      or v_weekday is null or v_weekday not between 0 and 6 or v_interval is null or v_interval not between 1 and 52
      or v_time is null then raise exception 'invalid_recurrence'; end if;
    v_day := v_start_date + ((v_weekday-extract(dow from v_start_date)::int+7)%7);
    while v_day<=v_end_date loop
      v_start := (v_day+v_time) at time zone 'Europe/Zurich';
      -- Reject nonexistent local times during the spring DST jump.
      if (v_start at time zone 'Europe/Zurich') <> (v_day+v_time) then raise exception 'invalid_recurrence'; end if;
      v_dates := array_append(v_dates,v_start);
      if cardinality(v_dates)>80 then raise exception 'too_many_occurrences'; end if;
      v_day := v_day + v_interval*7;
    end loop;
    if cardinality(v_dates)=0 then raise exception 'no_occurrence'; end if;
    insert into public.club_event_series(group_id,club_id,event_type,title,location_text,coach_note,duration_minutes,
      weekday,time_of_day,interval_weeks,start_date,end_date,is_active,created_by)
      values(v_group.id,v_group.club_id,v_type,nullif(btrim(p_template->>'title'),''),nullif(btrim(p_template->>'location_text'),''),
        nullif(btrim(p_template->>'coach_note'),''),v_duration,v_weekday,v_time,v_interval,v_start_date,v_end_date,true,auth.uid())
      returning id into v_series_id;
  end if;
  foreach v_start in array v_dates loop
    if p_mode='series' then v_end := v_start + make_interval(mins=>v_duration); end if;
    insert into public.club_events(group_id,club_id,series_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,created_by,requires_evaluation)
      values(v_group.id,v_group.club_id,v_series_id,v_type,nullif(btrim(p_template->>'title'),''),v_start,v_end,v_duration,
        nullif(btrim(p_template->>'location_text'),''),nullif(btrim(p_template->>'coach_note'),''),auth.uid(),v_type in ('training','camp') and coalesce((p_template->>'requires_evaluation')::boolean,false)) returning id into v_event_id;
    v_event_ids := array_append(v_event_ids,v_event_id);
    insert into public.club_event_coaches(event_id,coach_id) select v_event_id,id from (select distinct unnest(p_coach_ids) id) u
      on conflict(event_id,coach_id) do nothing;
    insert into public.club_event_attendees(event_id,player_id,status) select v_event_id,id,'present' from (select distinct unnest(p_player_ids) id) u
      on conflict(event_id,player_id) do nothing;
    perform public.manager_sync_event_criteria_v1(v_event_id,p_criterion_ids);
    v_position := 0;
    for v_item in select * from jsonb_array_elements(p_structure) loop
      insert into public.club_event_structure_items(event_id,category,minutes,note,position)
        values(v_event_id,v_item->>'category',(v_item->>'minutes')::int,nullif(btrim(v_item->>'note'),''),v_position);
      v_position := v_position+1;
    end loop;
  end loop;
  v_result := jsonb_build_object('ok',true,'event_ids',to_jsonb(v_event_ids),'series_id',v_series_id,'replayed',false);
  update public.manager_event_creation_requests set result=v_result where actor_id=auth.uid() and request_id=p_request_id;
  return v_result;
end;
$$;
revoke all on function public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[]) from public,anon;
grant execute on function public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[]) to authenticated;
create or replace function public.delete_manager_planning_v1(
  p_actor_id uuid, p_event_id uuid default null, p_series_id uuid default null,
  p_occurrence_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
  perform public.require_manager_club_scope_v1(p_actor_id,v_club);
  if p_event_id is not null and v_event.series_id is not null and not coalesce(p_occurrence_confirmed,false) then
    raise exception 'occurrence_confirmation_required';
  end if;
  -- Lock the complete set, never a paginated browser snapshot. Foreign or
  -- occurrences outside the club/group make the request fail before deletion.
  perform id from public.club_events where
    (p_series_id is not null and series_id = p_series_id) or id = p_event_id order by id for update;
  if exists (select 1 from public.club_events where
    ((p_series_id is not null and series_id = p_series_id) or id = p_event_id)
    and (group_id is distinct from v_group or club_id is distinct from v_club)
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
revoke all on function public.delete_manager_planning_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.delete_manager_planning_v1(uuid,uuid,uuid,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
