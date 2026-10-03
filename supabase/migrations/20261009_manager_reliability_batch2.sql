-- Manager planning and season saves are atomic. Requires the Coach occurrence
-- transaction (20261004) and the existing season/camp/evaluation schemas.
begin;

create or replace function public.require_manager_club_scope_v1(p_actor uuid, p_club uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or p_club is null then raise exception 'forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.app_admins where user_id=p_actor) then return; end if;
  perform 1 from public.club_members where club_id=p_club and user_id=p_actor and role='manager' and is_active for share;
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
end $$;
revoke all on function public.require_manager_club_scope_v1(uuid,uuid) from public,anon,authenticated;

-- Internal canonical snapshot: attendance responses deliberately do not form
-- part of the planning version, so a new RSVP never prevents an unrelated edit.
create or replace function public.manager_event_snapshot_v1(p_event uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('event',jsonb_build_object(
    'id',e.id,'group_id',e.group_id,'club_id',e.club_id,'series_id',e.series_id,'status',e.status,
    'event_type',e.event_type,'title',e.title,'starts_at',e.starts_at,'ends_at',e.ends_at,
    'duration_minutes',e.duration_minutes,'location_text',e.location_text,'coach_note',e.coach_note,
    'requires_evaluation',e.requires_evaluation),
    'coach_ids',coalesce((select jsonb_agg(coach_id order by coach_id) from public.club_event_coaches where event_id=e.id),'[]'),
    'player_ids',coalesce((select jsonb_agg(player_id order by player_id) from public.club_event_attendees where event_id=e.id),'[]'),
    'structure',coalesce((select jsonb_agg(jsonb_build_object('category',category,'minutes',minutes,'note',note,'position',position) order by position,id)
      from public.club_event_structure_items where event_id=e.id),'[]'),
    'criterion_ids',coalesce((select jsonb_agg(criterion_id order by position,id) from public.club_event_evaluation_criteria where event_id=e.id and is_enabled),'[]'),
    'camp_day',(select jsonb_build_object('camp_id',camp_id,'day_index',day_index,'starts_at',starts_at,'ends_at',ends_at,'location_text',location_text)
      from public.club_camp_days where event_id=e.id))
  from public.club_events e where e.id=p_event;
$$;
revoke all on function public.manager_event_snapshot_v1(uuid) from public,anon,authenticated;

create or replace function public.get_manager_planning_snapshot_v1(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.club_events%rowtype; result jsonb; s jsonb;
begin
  select * into e from public.club_events where id=p_event_id;
  if not found then raise exception 'event_not_found' using errcode='P0002'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),e.club_id);
  result := public.manager_event_snapshot_v1(e.id);
  if e.series_id is not null then
    select to_jsonb(x) into s from public.club_event_series x where id=e.series_id;
    result := result || jsonb_build_object('series',s,'future',coalesce((
      select jsonb_agg(public.manager_event_snapshot_v1(x.id) order by x.starts_at,x.id)
      from public.club_events x where x.series_id=e.series_id and x.starts_at>=now()),'[]'));
  end if;
  return result;
end $$;
revoke all on function public.get_manager_planning_snapshot_v1(uuid) from public,anon;
grant execute on function public.get_manager_planning_snapshot_v1(uuid) to authenticated;

create or replace function public.prepare_event_evaluation_criterion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_criterion public.club_evaluation_criteria%rowtype;
  v_event_club uuid;
begin
  select * into v_criterion from public.club_evaluation_criteria where id = new.criterion_id;
  select club_id into v_event_club from public.club_events where id = new.event_id;
  if v_criterion.id is null or v_event_club is null or v_criterion.club_id <> v_event_club then
    raise exception 'Criterion and activity must belong to the same club' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.criterion_id is distinct from old.criterion_id or new.event_id is distinct from old.event_id)
    and (v_criterion.archived_at is not null or not v_criterion.is_active) then
    raise exception 'Inactive or archived criterion cannot be selected' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.criterion_id is distinct from old.criterion_id or new.event_id is distinct from old.event_id)
    and not exists (select 1 from public.club_events e where e.id = new.event_id and e.event_type = any(v_criterion.activity_types)) then
    raise exception 'Criterion does not apply to this activity type' using errcode = '23514';
  end if;
  if new.is_enabled and (select count(*) from public.club_event_evaluation_criteria x where x.event_id = new.event_id and x.is_enabled and x.id <> new.id) >= 3 then
    raise exception 'Maximum three custom criteria per activity' using errcode = '23514';
  end if;
  new.club_id := v_criterion.club_id;
  if tg_op = 'INSERT' then
    new.snapshot_name := v_criterion.name;
    new.snapshot_description := v_criterion.description;
    new.snapshot_respondent := v_criterion.respondent;
    new.snapshot_response_format := v_criterion.response_format;
    new.snapshot_choices := v_criterion.choices_json;
    new.snapshot_domain_key := v_criterion.domain_key;
    new.snapshot_domain_label := v_criterion.domain_label;
    new.snapshot_is_required := v_criterion.is_required;
  end if;
  return new;
end;
$$;

create or replace function public.manager_sync_event_criteria_v1(p_event uuid,p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare club uuid; kind text; criterion uuid; pos int := 0;
begin
  select club_id,event_type into club,kind from public.club_events where id=p_event;
  if p_ids is null or cardinality(p_ids)>3 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then
    raise exception 'invalid_criteria' using errcode='22023';
  end if;
  if exists(select 1 from unnest(p_ids) x where not exists(
    select 1 from public.club_evaluation_criteria c where c.id=x and c.club_id=club
    and (exists(select 1 from public.club_event_evaluation_criteria ec where ec.event_id=p_event and ec.criterion_id=x)
      or (c.is_active and kind=any(c.activity_types))))) then
    raise exception 'invalid_criteria' using errcode='22023';
  end if;
  -- Disable instead of deleting: snapshots and every existing answer survive.
  update public.club_event_evaluation_criteria set is_enabled=false where event_id=p_event;
  foreach criterion in array p_ids loop
    pos := pos+1;
    update public.club_event_evaluation_criteria set is_enabled=true,position=pos where event_id=p_event and criterion_id=criterion;
    if not found then
      insert into public.club_event_evaluation_criteria(event_id,club_id,criterion_id,position) values(p_event,club,criterion,pos);
    end if;
  end loop;
end $$;
revoke all on function public.manager_sync_event_criteria_v1(uuid,uuid[]) from public,anon,authenticated;

create or replace function public.update_manager_event_occurrence_v1(
  p_event_id uuid,p_expected jsonb,p_changes jsonb,p_coach_ids uuid[],p_player_ids uuid[],p_structure jsonb,p_criterion_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.club_events%rowtype; saved jsonb;
begin
  select * into e from public.club_events where id=p_event_id for update;
  if not found then raise exception 'event_not_found' using errcode='P0002'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),e.club_id);
  perform 1 from public.club_event_coaches where event_id=e.id for update;
  perform 1 from public.club_event_attendees where event_id=e.id for update;
  perform 1 from public.club_event_structure_items where event_id=e.id for update;
  perform 1 from public.club_event_evaluation_criteria where event_id=e.id for update;
  perform 1 from public.club_camp_days where event_id=e.id for update;
  if public.manager_event_snapshot_v1(e.id) is distinct from (p_expected-'series'-'future') then
    raise exception 'planning_conflict' using errcode='40001';
  end if;
  -- The shared transaction already checks dates, membership, removal of recorded
  -- work, and applies roster deltas without touching retained attendee rows.
  if exists(select 1 from public.club_event_player_feedback f where f.event_id=e.id
    and p_player_ids is not null and not(f.player_id=any(p_player_ids))) then
    raise exception 'evaluated_attendee_removal' using errcode='22023';
  end if;
  if e.event_type='camp' and p_player_ids is not null then
    if exists(select 1 from public.club_camp_days where event_id=e.id) then raise exception 'use_camp_editor' using errcode='22023'; end if;
    if cardinality(p_player_ids)>2000 or exists(select 1 from unnest(p_player_ids) x where x is null or (
      not exists(select 1 from public.club_event_attendees a where a.event_id=e.id and a.player_id=x)
      and not exists(select 1 from public.club_members m where m.club_id=e.club_id and m.user_id=x and m.is_active))) then
      raise exception 'invalid_assignments' using errcode='22023';
    end if;
    if exists(select 1 from public.club_event_attendees a where a.event_id=e.id and not(a.player_id=any(p_player_ids)) and (
      a.coach_recorded_status is not null
      or exists(select 1 from public.club_event_coach_feedback f where f.event_id=e.id and f.player_id=a.player_id)
      or exists(select 1 from public.club_event_evaluation_responses f where f.event_id=e.id and f.player_id=a.player_id)
      or exists(select 1 from public.club_event_player_structure_items f where f.event_id=e.id and f.player_id=a.player_id)
      or exists(select 1 from public.coach_player_private_notes f where f.event_id=e.id and f.player_id=a.player_id))) then
      raise exception 'evaluated_attendee_removal' using errcode='22023';
    end if;
    delete from public.club_event_attendees where event_id=e.id and not(player_id=any(p_player_ids));
    insert into public.club_event_attendees(event_id,player_id,status) select e.id,x,'present' from unnest(p_player_ids) x on conflict do nothing;
  end if;
  saved := public.update_coach_event_occurrence_v1(e.id,p_expected,p_changes,p_coach_ids,
    case when e.event_type='camp' then null else p_player_ids end,p_structure);
  update public.club_events set requires_evaluation=coalesce((p_changes->>'requires_evaluation')::boolean,false) where id=e.id;
  perform public.manager_sync_event_criteria_v1(e.id,p_criterion_ids);
  return saved;
end $$;
revoke all on function public.update_manager_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[]) from public,anon;
grant execute on function public.update_manager_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[]) to authenticated;

create or replace function public.update_manager_event_series_v1(
  p_event_id uuid,p_expected jsonb,p_series jsonb,p_coach_ids uuid[],p_player_ids uuid[],p_structure jsonb,p_criterion_ids uuid[],p_timezone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.club_events%rowtype; s public.club_event_series%rowtype; item jsonb; snap jsonb; changes jsonb;
  expected_future jsonb; actual_future jsonb; dates timestamptz[] := '{}'; event_ids uuid[] := '{}';
  coaches uuid[]; players uuid[]; criteria uuid[]; structure jsonb; target uuid; start_day date; end_day date; cursor_day date;
  v_weekday int; weeks int; duration int; time_day time; active boolean; start_time timestamptz; end_time timestamptz;
  i int := 0; result jsonb; recipient_ids uuid[] := '{}';
begin
  select * into e from public.club_events where id=p_event_id;
  if not found or e.series_id is null then raise exception 'series_not_found' using errcode='P0002'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),e.club_id);
  select * into s from public.club_event_series where id=e.series_id for update;
  if s.club_id<>e.club_id or s.group_id<>e.group_id then raise exception 'forbidden' using errcode='42501'; end if;
  if to_jsonb(s) is distinct from p_expected->'series' then raise exception 'planning_conflict' using errcode='40001'; end if;
  perform 1 from public.club_events where series_id=s.id and starts_at>=now() order by starts_at,id for update;
  perform 1 from public.club_event_coaches where event_id in(select id from public.club_events where series_id=s.id and starts_at>=now()) for update;
  perform 1 from public.club_event_attendees where event_id in(select id from public.club_events where series_id=s.id and starts_at>=now()) for update;
  perform 1 from public.club_event_structure_items where event_id in(select id from public.club_events where series_id=s.id and starts_at>=now()) for update;
  perform 1 from public.club_event_evaluation_criteria where event_id in(select id from public.club_events where series_id=s.id and starts_at>=now()) for update;
  select coalesce(jsonb_agg(public.manager_event_snapshot_v1(x.id) order by starts_at,id),'[]') into actual_future
    from public.club_events x where series_id=s.id and starts_at>=now();
  -- An occurrence which started while the form was open is now historical.
  select coalesce(jsonb_agg(x order by (x#>>'{event,starts_at}')::timestamptz,x#>>'{event,id}'),'[]') into expected_future
    from jsonb_array_elements(p_expected->'future') x where (x#>>'{event,starts_at}')::timestamptz>=now();
  if exists(select 1 from public.club_camp_days d join public.club_events ce on ce.id=d.event_id where ce.series_id=s.id) then
    raise exception 'use_camp_editor' using errcode='22023';
  end if;
  if actual_future is distinct from expected_future then raise exception 'planning_conflict' using errcode='40001'; end if;
  start_day := (p_series->>'start_date')::date; end_day := (p_series->>'end_date')::date;
  v_weekday := (p_series->>'weekday')::int; weeks := (p_series->>'interval_weeks')::int;
  time_day := (p_series->>'time_of_day')::time; duration := (p_series->>'duration_minutes')::int;
  active := (p_series->>'is_active')::boolean;
  if start_day is null or end_day is null or end_day<start_day or end_day-start_day>3660
    or v_weekday is null or v_weekday not between 0 and 6 or weeks is null or weeks not between 1 and 52
    or duration is null or duration not between 1 and 300 or time_day is null or active is null
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
    or p_series->>'event_type' not in ('training','interclub','session','event','camp') then
    raise exception 'invalid_series' using errcode='22023';
  end if;
  if active then
    cursor_day := start_day + ((v_weekday-extract(dow from start_day)::int+7)%7);
    while cursor_day<=end_day loop
      start_time := (cursor_day+time_day) at time zone p_timezone;
      if start_time>=now() then dates := array_append(dates,start_time); end if;
      cursor_day := cursor_day+7*weeks;
      if cardinality(dates)>80 then raise exception 'series_limit' using errcode='22023'; end if;
    end loop;
    if cardinality(dates)=0 then raise exception 'empty_series' using errcode='22023'; end if;
  end if;
  -- Reuse the chronological occurrences. Cancel excess slots; never delete
  -- their discussions, RSVPs, individual programmes or evaluations.
  for item in select value from jsonb_array_elements(actual_future) loop
    if item#>>'{event,status}'='cancelled' then continue; end if;
    target := (item#>>'{event,id}')::uuid;
    event_ids := array_append(event_ids,target);
  end loop;
  for i in 1..greatest(cardinality(event_ids),cardinality(dates)) loop
    if i>cardinality(dates) then
      recipient_ids := recipient_ids || array(select a.player_id from public.club_event_attendees a where a.event_id=event_ids[i]
        and coalesce(a.status,'expected') not in ('absent','excused') and coalesce(a.coach_recorded_status,'present')<>'absent');
      update public.club_events set status='cancelled' where id=event_ids[i];
      continue;
    end if;
    target := event_ids[i];
    if target is null then
      insert into public.club_events(club_id,group_id,series_id,created_by,event_type,title,starts_at,ends_at,duration_minutes,status)
        values(s.club_id,s.group_id,s.id,auth.uid(),p_series->>'event_type',nullif(btrim(p_series->>'title'),''),dates[i],dates[i]+make_interval(mins=>duration),duration,'scheduled') returning id into target;
      snap := public.manager_event_snapshot_v1(target);
      coaches := p_coach_ids; players := p_player_ids; structure := p_structure; criteria := p_criterion_ids;
      changes := p_series || jsonb_build_object('starts_at',dates[i],'ends_at',dates[i]+make_interval(mins=>duration));
    else
      snap := public.manager_event_snapshot_v1(target);
      if snap#>>'{event,status}'='cancelled' then continue; end if;
      changes := snap->'event';
      -- Keep occurrence-specific overrides. Only template-derived values follow
      -- the recurrence template; roster changes are deltas from the edited form.
      foreach item in array array['"event_type"'::jsonb,'"title"'::jsonb,'"location_text"'::jsonb,'"coach_note"'::jsonb] loop
        if changes->(item#>>'{}') is not distinct from to_jsonb(s)->(item#>>'{}') then
          changes := jsonb_set(changes,array[item#>>'{}'],coalesce(p_series->(item#>>'{}'),'null'));
        end if;
      end loop;
      start_time := (changes->>'starts_at')::timestamptz;
      end_time := (changes->>'ends_at')::timestamptz;
      if (start_time at time zone p_timezone)::time=s.time_of_day
        and extract(dow from start_time at time zone p_timezone)::int=s.weekday then
        end_time := dates[i]+coalesce(end_time-start_time,make_interval(mins=>(changes->>'duration_minutes')::int));
        start_time := dates[i];
      end if;
      if (changes->>'duration_minutes')::int=s.duration_minutes then
        changes := changes || jsonb_build_object('duration_minutes',duration);
        end_time := start_time+make_interval(mins=>duration);
      end if;
      changes := changes || jsonb_build_object('starts_at',start_time,'ends_at',end_time);
      if changes->'requires_evaluation' is not distinct from p_expected#>'{event,requires_evaluation}' then
        changes := changes || jsonb_build_object('requires_evaluation',p_series->'requires_evaluation');
      end if;
      select coalesce(array_agg(distinct x::uuid),'{}') into coaches from (
        select value x from jsonb_array_elements_text(snap->'coach_ids') where not (value in (select jsonb_array_elements_text(p_expected->'coach_ids')) and not(value::uuid=any(p_coach_ids)))
        union select x::text from unnest(p_coach_ids) x where not(x::text in (select jsonb_array_elements_text(p_expected->'coach_ids')))) q;
      select coalesce(array_agg(distinct x::uuid),'{}') into players from (
        select value x from jsonb_array_elements_text(snap->'player_ids') where not (value in (select jsonb_array_elements_text(p_expected->'player_ids')) and not(value::uuid=any(p_player_ids)))
        union select x::text from unnest(p_player_ids) x where not(x::text in (select jsonb_array_elements_text(p_expected->'player_ids')))) q;
      structure := case when snap->'structure'=p_expected->'structure' then p_structure else snap->'structure' end;
      criteria := case when snap->'criterion_ids'=p_expected->'criterion_ids' then p_criterion_ids
        else array(select jsonb_array_elements_text(snap->'criterion_ids')::uuid) end;
    end if;
    result := public.update_manager_event_occurrence_v1(target,snap,changes,coaches,players,structure,criteria);
    recipient_ids := recipient_ids || array(select jsonb_array_elements_text(result->'recipient_ids')::uuid);
  end loop;
  update public.club_event_series set event_type=p_series->>'event_type',title=nullif(btrim(p_series->>'title'),''),
    weekday=v_weekday,time_of_day=time_day,interval_weeks=weeks,start_date=start_day,end_date=end_day,duration_minutes=duration,
    location_text=nullif(btrim(p_series->>'location_text'),''),coach_note=nullif(btrim(p_series->>'coach_note'),''),is_active=active where id=s.id;
  return jsonb_build_object('ok',true,'recipient_ids',(select coalesce(jsonb_agg(distinct x),'[]') from unnest(recipient_ids) x));
end $$;
revoke all on function public.update_manager_event_series_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text) from public,anon;
grant execute on function public.update_manager_event_series_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text) to authenticated;

create or replace function public.create_manager_season_v1(p_actor uuid,p_club uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare season public.club_seasons%rowtype; source uuid; copied int;
begin
  perform public.require_manager_club_scope_v1(p_actor,p_club);
  -- Serializes both concurrent season creation and the current-season switch.
  perform 1 from public.clubs where id=p_club for update;
  if not found then raise exception 'club_not_found' using errcode='P0002'; end if;
  if nullif(btrim(p_values->>'name'),'') is null or (p_values->>'starts_on')::date is null
    or (p_values->>'ends_on')::date is null or (p_values->>'ends_on')::date<(p_values->>'starts_on')::date then
    raise exception 'invalid_season' using errcode='22023';
  end if;
  select id into source from public.club_seasons where club_id=p_club and ends_on<=(p_values->>'starts_on')::date order by ends_on desc,id limit 1;
  if coalesce((p_values->>'is_current')::boolean,false) then update public.club_seasons set is_current=false where club_id=p_club and is_current; end if;
  insert into public.club_seasons(club_id,name,starts_on,ends_on,is_current) values(p_club,btrim(p_values->>'name'),
    (p_values->>'starts_on')::date,(p_values->>'ends_on')::date,coalesce((p_values->>'is_current')::boolean,false)) returning * into season;
  -- The existing after-insert trigger copies groups and Coach season records.
  insert into public.club_player_season_records(club_season_id,club_member_id,course_label,group_id,registration_status,membership_status,playing_right_status)
    select season.id,r.club_member_id,r.course_label,case when r.registration_status='active' then g.id end,
      r.registration_status,r.membership_status,r.playing_right_status
    from public.club_player_season_records r left join public.coach_groups g on g.club_season_id=season.id and g.copied_from_group_id=r.group_id
    where r.club_season_id=source;
  get diagnostics copied=row_count;
  insert into public.club_player_season_field_values(club_player_season_record_id,field_id,value_json)
    select dest.id,v.field_id,v.value_json from public.club_player_season_field_values v
    join public.club_player_season_records src on src.id=v.club_player_season_record_id and src.club_season_id=source
    join public.club_player_season_records dest on dest.club_member_id=src.club_member_id and dest.club_season_id=season.id;
  return jsonb_build_object('season',to_jsonb(season),'copied_records',copied);
end $$;
revoke all on function public.create_manager_season_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_manager_season_v1(uuid,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
