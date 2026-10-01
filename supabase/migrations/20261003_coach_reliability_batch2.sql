-- Deploy with the Coach batch 2 application, after the batch 1 security migration.
-- No data reset. Every RPC is a single transaction; failures roll back all writes.
begin;

create or replace function public.save_coach_training_player_evaluation_v2(
  p_event_id uuid, p_coach_id uuid, p_player_id uuid, p_status text,
  p_engagement integer, p_attitude integer, p_performance integer,
  p_source_text text, p_private_note text, p_update_comment boolean,
  p_expected_recorded_at timestamptz, p_custom_responses jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event public.club_events%rowtype;
  v_attendee public.club_event_attendees%rowtype;
  v_criterion public.club_event_evaluation_criteria%rowtype;
  v_answer jsonb;
  v_key text;
  v_result jsonb;
begin
  select * into v_event from public.club_events where id = p_event_id for update;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  if not public.can_manage_coach_event(p_event_id, p_coach_id) then raise exception 'forbidden'; end if;
  if v_event.requires_evaluation = false then raise exception 'evaluation_disabled'; end if;
  select * into v_attendee from public.club_event_attendees
    where event_id = p_event_id and player_id = p_player_id for update;
  if v_attendee.player_id is null then raise exception 'unknown_attendee'; end if;
  if v_attendee.coach_recorded_at is distinct from p_expected_recorded_at then raise exception 'evaluation_conflict'; end if;
  if p_custom_responses is null or jsonb_typeof(p_custom_responses) <> 'object' then raise exception 'invalid_custom_responses'; end if;

  -- Validate the entire submission before touching feedback, presence or answers.
  perform 1 from public.club_event_evaluation_criteria where event_id = p_event_id for share;
  for v_key in select jsonb_object_keys(p_custom_responses) loop
    if not exists (select 1 from public.club_event_evaluation_criteria
      where id::text = v_key and event_id = p_event_id and is_enabled and snapshot_respondent in ('coach','both')) then
      raise exception 'invalid_custom_criterion';
    end if;
  end loop;
  if p_status = 'present' then
    for v_criterion in select * from public.club_event_evaluation_criteria
      where event_id = p_event_id and is_enabled and snapshot_respondent in ('coach','both') loop
      v_answer := p_custom_responses -> v_criterion.id::text;
      if v_answer is null or v_answer = 'null'::jsonb or v_answer = '""'::jsonb then
        if v_criterion.snapshot_is_required then raise exception 'required_criteria_missing'; end if;
      elsif v_criterion.snapshot_response_format = 'short_text' then
        if jsonb_typeof(v_answer) <> 'string' or char_length(btrim(v_answer #>> '{}')) not between 1 and 240 then
          raise exception 'invalid_custom_response';
        end if;
      elsif not exists (select 1 from jsonb_array_elements(v_criterion.snapshot_choices) choice where choice->'value' = v_answer) then
        raise exception 'invalid_custom_response';
      end if;
    end loop;
  end if;

  v_result := public.save_coach_training_player_evaluation_v1(p_event_id, p_coach_id, p_player_id,
    p_status, p_engagement, p_attitude, p_performance, p_source_text, p_private_note, p_update_comment);
  delete from public.club_event_evaluation_responses r where r.event_id = p_event_id and r.player_id = p_player_id
    and r.respondent_role = 'coach' and (p_status = 'absent' or exists (
      select 1 from public.club_event_evaluation_criteria c where c.id = r.event_criterion_id and c.is_enabled));
  if p_status = 'present' then
    insert into public.club_event_evaluation_responses
      (club_id,event_id,event_criterion_id,player_id,respondent_user_id,respondent_role,value_json)
    select v_event.club_id,p_event_id,c.id,p_player_id,p_coach_id,'coach',p_custom_responses->c.id::text
    from public.club_event_evaluation_criteria c where c.event_id = p_event_id and c.is_enabled
      and c.snapshot_respondent in ('coach','both') and p_custom_responses ? c.id::text
      and p_custom_responses->c.id::text not in ('null'::jsonb,'""'::jsonb);
  else
    -- An explicit absence must not resurrect an old junior-visible comment on reload.
    update public.coach_training_debriefs set individual_comments = individual_comments - p_player_id::text,
      report_version = report_version + 1, updated_at = now(), author_coach_id = p_coach_id
      where event_id = p_event_id and individual_comments ? p_player_id::text;
  end if;
  return v_result || jsonb_build_object('recorded_at', (select coach_recorded_at from public.club_event_attendees
    where event_id = p_event_id and player_id = p_player_id));
end;
$$;
revoke all on function public.save_coach_training_player_evaluation_v2(uuid,uuid,uuid,text,integer,integer,integer,text,text,boolean,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.save_coach_training_player_evaluation_v2(uuid,uuid,uuid,text,integer,integer,integer,text,text,boolean,timestamptz,jsonb) to service_role;

create or replace function public.patch_coach_camp_registrations_v1(p_camp_id uuid, p_actor_id uuid, p_registrations jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_camp public.club_camps%rowtype;
  v_existing public.club_camp_players%rowtype;
  v_entry jsonb;
  v_player uuid;
  v_status text;
  v_day record;
  v_key text;
  v_day_status text;
  v_seen uuid[] := '{}';
begin
  select * into v_camp from public.club_camps where id = p_camp_id for update;
  if v_camp.id is null then raise exception 'camp_not_found'; end if;
  if not exists(select 1 from public.club_members where club_id = v_camp.club_id
    and user_id = p_actor_id and is_active and role in ('coach','manager')) then raise exception 'forbidden'; end if;
  if p_registrations is null or jsonb_typeof(p_registrations) <> 'array' or jsonb_array_length(p_registrations) > 1000 then
    raise exception 'invalid_registrations';
  end if;
  -- Lock related rows before any patch; omitted players/days are untouched.
  perform 1 from public.club_camp_days where camp_id = p_camp_id order by day_index for share;
  for v_entry in select * from jsonb_array_elements(p_registrations) loop
    if jsonb_typeof(v_entry) <> 'object' then raise exception 'invalid_registration'; end if;
    v_player := (v_entry->>'player_id')::uuid;
    if v_player is null or v_player = any(v_seen) then raise exception 'invalid_player'; end if;
    v_seen := array_append(v_seen,v_player);
    if not exists(select 1 from public.club_members where club_id = v_camp.club_id and user_id = v_player
      and role = 'player' and is_active) then raise exception 'invalid_player'; end if;
    select * into v_existing from public.club_camp_players where camp_id = p_camp_id and player_id = v_player for update;
    v_status := case when v_entry ? 'registration_status' then v_entry->>'registration_status'
      else coalesce(v_existing.registration_status,'invited') end;
    if v_status is null or v_status not in ('invited','registered','declined') then raise exception 'invalid_registration_status'; end if;
    if v_entry ? 'day_status_by_day_index' and jsonb_typeof(v_entry->'day_status_by_day_index') <> 'object' then
      raise exception 'invalid_day_status';
    end if;
    for v_key,v_day_status in select * from jsonb_each_text(coalesce(v_entry->'day_status_by_day_index','{}'::jsonb)) loop
      if v_day_status is null or v_day_status not in ('present','absent') or not exists (
        select 1 from public.club_camp_days where camp_id = p_camp_id and day_index::text = v_key) then
        raise exception 'invalid_day_status';
      end if;
      if v_status <> 'registered' then raise exception 'day_status_requires_registration'; end if;
    end loop;
    insert into public.club_camp_players(camp_id,player_id,registration_status,registered_at)
      values(p_camp_id,v_player,v_status,case when v_status = 'registered' then coalesce(v_existing.registered_at,now()) end)
      on conflict(camp_id,player_id) do update set registration_status = excluded.registration_status, registered_at = excluded.registered_at;
    for v_day in select event_id,day_index from public.club_camp_days where camp_id = p_camp_id order by day_index loop
      v_day_status := v_entry->'day_status_by_day_index'->>v_day.day_index::text;
      insert into public.club_event_attendees(event_id,player_id,status)
        values(v_day.event_id,v_player,case when v_status = 'registered' then coalesce(v_day_status,'present') else 'not_registered' end)
        on conflict(event_id,player_id) do update set
          status = case when v_day_status is not null then v_day_status
            when club_event_attendees.coach_recorded_status is not null then club_event_attendees.status
            when v_status <> 'registered' then 'not_registered'
            when club_event_attendees.status = 'not_registered' then 'present'
            else club_event_attendees.status end,
          coach_recorded_status = case when v_day_status is not null and club_event_attendees.coach_recorded_status is not null
            then v_day_status else club_event_attendees.coach_recorded_status end,
          coach_recorded_by = case when v_day_status is not null and club_event_attendees.coach_recorded_status is not null
            and club_event_attendees.status is distinct from v_day_status then p_actor_id else club_event_attendees.coach_recorded_by end,
          coach_recorded_at = case when v_day_status is not null and club_event_attendees.coach_recorded_status is not null
            and club_event_attendees.status is distinct from v_day_status then now() else club_event_attendees.coach_recorded_at end;
    end loop;
  end loop;
  return jsonb_build_object('ok',true,'updated_player_ids',to_jsonb(v_seen));
end;
$$;
revoke all on function public.patch_coach_camp_registrations_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.patch_coach_camp_registrations_v1(uuid,uuid,jsonb) to service_role;

-- Scoped, atomic recurrence edit. Keep event IDs and all dependent rows; retire
-- surplus occurrences by cancellation instead of cascading deletes.
create or replace function public.update_coach_event_series_v1(
  p_source_event_id uuid, p_template jsonb, p_coach_ids uuid[], p_player_ids uuid[], p_structure jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_source public.club_events%rowtype;
  v_series public.club_event_series%rowtype;
  v_start date := (p_template->>'start_date')::date;
  v_end date := (p_template->>'end_date')::date;
  v_weekday int := (p_template->>'weekday')::int;
  v_interval int := (p_template->>'interval_weeks')::int;
  v_duration int := (p_template->>'duration_minutes')::int;
  v_time time := (p_template->>'time_of_day')::time;
  v_active boolean := (p_template->>'is_active')::boolean;
  v_type text := p_template->>'event_type';
  v_day date;
  v_start_at timestamptz;
  v_dates timestamptz[] := '{}';
  v_existing uuid[] := '{}';
  v_used uuid[] := '{}';
  v_id uuid;
  v_item jsonb;
  v_position int;
begin
  select * into v_source from public.club_events where id = p_source_event_id;
  if v_source.id is null then raise exception 'event_not_found'; end if;
  select * into v_series from public.club_event_series where id = v_source.series_id for update;
  if v_series.id is null then raise exception 'series_not_found'; end if;
  if auth.uid() is null or not public.can_manage_assigned_group(v_series.group_id,auth.uid(),'planning')
    or v_source.club_id <> v_series.club_id or v_source.group_id <> v_series.group_id then raise exception 'forbidden'; end if;
  if v_start is null or v_end is null or v_end < v_start or v_end - v_start > 1827
    or v_weekday is null or v_weekday not between 0 and 6 or v_interval is null or v_interval not between 1 and 52
    or v_duration is null or v_duration not between 1 and 300 or v_time is null or v_active is null
    or v_type is null or v_type not in ('training','interclub','session','event') then raise exception 'invalid_recurrence'; end if;
  if v_source.event_type = 'camp' then raise exception 'use_camp_editor'; end if;
  if v_type in ('session','event') and nullif(btrim(p_template->>'title'),'') is null then raise exception 'title_required'; end if;
  if p_coach_ids is null or p_player_ids is null or p_structure is null or jsonb_typeof(p_structure) <> 'array'
    or jsonb_array_length(p_structure) > 100 then raise exception 'invalid_assignments'; end if;
  if exists(select 1 from unnest(p_coach_ids) u(id) where not exists(select 1 from public.club_members m
    where m.club_id = v_series.club_id and m.user_id = u.id and m.is_active and m.role in ('coach','manager')))
    or exists(select 1 from unnest(p_player_ids) u(id) where not exists(select 1 from public.club_members m
      where m.club_id = v_series.club_id and m.user_id = u.id and m.is_active)) then raise exception 'invalid_assignments'; end if;
  for v_item in select * from jsonb_array_elements(p_structure) loop
    if nullif(btrim(v_item->>'category'),'') is null or (v_item->>'minutes')::int is null
      or (v_item->>'minutes')::int not between 1 and 300 then raise exception 'invalid_structure'; end if;
  end loop;
  -- Generate the FULL plan first; never silently truncate a recurrence at 80.
  v_day := v_start + ((v_weekday - extract(dow from v_start)::int + 7) % 7);
  while v_active and v_day <= v_end loop
    v_start_at := (v_day + v_time) at time zone 'Europe/Zurich';
    if v_start_at >= now() then v_dates := array_append(v_dates,v_start_at); end if;
    if cardinality(v_dates) > 80 then raise exception 'too_many_occurrences'; end if;
    v_day := v_day + v_interval * 7;
  end loop;
  if v_active and cardinality(v_dates) = 0 then raise exception 'no_future_occurrence'; end if;
  perform 1 from public.club_events where series_id = v_series.id and starts_at >= now() order by id for update;
  select coalesce(array_agg(id order by starts_at,id),'{}'::uuid[]) into v_existing
    from public.club_events where series_id = v_series.id and starts_at >= now() and status = 'scheduled';

  update public.club_event_series set event_type = v_type, title = nullif(btrim(p_template->>'title'),''),
    weekday = v_weekday, time_of_day = v_time, interval_weeks = v_interval, start_date = v_start, end_date = v_end,
    duration_minutes = v_duration, location_text = nullif(btrim(p_template->>'location_text'),''),
    coach_note = nullif(btrim(p_template->>'coach_note'),''), is_active = v_active where id = v_series.id;
  foreach v_start_at in array v_dates loop
    v_id := null;
    -- Match the existing calendar day first, then reuse a displaced occurrence
    -- only when its old date is not itself required by the new plan.
    select id into v_id from public.club_events where id = any(v_existing) and not(id = any(v_used))
      and (starts_at at time zone 'Europe/Zurich')::date = (v_start_at at time zone 'Europe/Zurich')::date
      order by starts_at,id limit 1;
    if v_id is null then
      select e.id into v_id from public.club_events e where e.id = any(v_existing) and not(e.id = any(v_used))
        and not exists(select 1 from unnest(v_dates) d(t) where
          (d.t at time zone 'Europe/Zurich')::date = (e.starts_at at time zone 'Europe/Zurich')::date)
        order by e.starts_at,e.id limit 1;
    end if;
    if v_id is null then
      insert into public.club_events(group_id,club_id,series_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,created_by,requires_evaluation)
        values(v_series.group_id,v_series.club_id,v_series.id,v_type,nullif(btrim(p_template->>'title'),''),v_start_at,
          v_start_at + make_interval(mins=>v_duration),v_duration,nullif(btrim(p_template->>'location_text'),''),
          nullif(btrim(p_template->>'coach_note'),''),auth.uid(),v_source.requires_evaluation) returning id into v_id;
      insert into public.club_event_evaluation_criteria(club_id,event_id,criterion_id,position)
        select club_id,v_id,criterion_id,position from public.club_event_evaluation_criteria
        where event_id = p_source_event_id and is_enabled and criterion_id is not null;
    else
      update public.club_events set event_type = v_type,title = nullif(btrim(p_template->>'title'),''),
        starts_at = v_start_at,ends_at = v_start_at + make_interval(mins=>v_duration),duration_minutes = v_duration,
        location_text = nullif(btrim(p_template->>'location_text'),''),coach_note = nullif(btrim(p_template->>'coach_note'),'')
        where id = v_id;
    end if;
    v_used := array_append(v_used,v_id);
    delete from public.club_event_coaches where event_id = v_id and not(coach_id = any(p_coach_ids));
    insert into public.club_event_coaches(event_id,coach_id) select v_id,id from unnest(p_coach_ids) u(id)
      on conflict(event_id,coach_id) do nothing;
    -- Retained attendees keep attendance and all recorded metadata. Refuse to
    -- remove an attendee with recorded work instead of silently deleting it.
    if exists(select 1 from public.club_event_attendees a where a.event_id = v_id and not(a.player_id = any(p_player_ids))
      and (a.coach_recorded_status is not null or exists(select 1 from public.club_event_coach_feedback f
        where f.event_id = v_id and f.player_id = a.player_id)
        or exists(select 1 from public.club_event_evaluation_responses r where r.event_id = v_id and r.player_id = a.player_id))) then
      raise exception 'evaluated_attendee_removal';
    end if;
    delete from public.club_event_attendees where event_id = v_id and not(player_id = any(p_player_ids));
    insert into public.club_event_attendees(event_id,player_id,status) select v_id,id,'present' from unnest(p_player_ids) u(id)
      on conflict(event_id,player_id) do nothing;
    delete from public.club_event_structure_items where event_id = v_id;
    v_position := 0;
    for v_item in select * from jsonb_array_elements(p_structure) loop
      insert into public.club_event_structure_items(event_id,category,minutes,note,position)
        values(v_id,v_item->>'category',(v_item->>'minutes')::int,nullif(btrim(v_item->>'note'),''),v_position);
      v_position := v_position + 1;
    end loop;
  end loop;
  update public.club_events set status = 'cancelled' where id = any(v_existing) and not(id = any(v_used));
  return jsonb_build_object('ok',true,'event_ids',to_jsonb(v_used));
end;
$$;
revoke all on function public.update_coach_event_series_v1(uuid,jsonb,uuid[],uuid[],jsonb) from public,anon;
grant execute on function public.update_coach_event_series_v1(uuid,jsonb,uuid[],uuid[],jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
