-- Apply after 20261009_manager_reliability_batch2.sql.
begin;

create or replace function public.manager_camp_version_v1(p_camp uuid)
returns text language sql stable security definer set search_path='' as $$
  select md5(jsonb_build_object('camp',to_jsonb(c),
    'groups',(select jsonb_agg(x order by group_id) from public.club_camp_groups x where camp_id=c.id),
    'coaches',(select jsonb_agg(x order by coach_id) from public.club_camp_coaches x where camp_id=c.id),
    'players',(select jsonb_agg(x order by player_id) from public.club_camp_players x where camp_id=c.id),
    'days',(select jsonb_agg(jsonb_build_object('day',to_jsonb(d),'planning',public.manager_event_snapshot_v1(d.event_id),
      'attendees',(select jsonb_agg(a order by player_id) from public.club_event_attendees a where event_id=d.event_id)) order by d.id)
      from public.club_camp_days d where d.camp_id=c.id),
    'options',(select jsonb_agg(jsonb_build_object('option',to_jsonb(o),
      'days',(select jsonb_agg(x order by camp_day_id) from public.club_camp_option_days x where option_id=o.id),
      'players',(select jsonb_agg(x order by player_id) from public.club_camp_player_options x where option_id=o.id)) order by o.id)
      from public.club_camp_options o where o.camp_id=c.id))::text)
  from public.club_camps c where c.id=p_camp;
$$;
revoke all on function public.manager_camp_version_v1(uuid) from public,anon,authenticated;

create or replace function public.get_manager_camp_versions_v1(p_actor uuid,p_club_ids uuid[],p_camp uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare club uuid; result jsonb;
begin
  foreach club in array p_club_ids loop perform public.require_manager_club_scope_v1(p_actor,club); end loop;
  select coalesce(jsonb_object_agg(id,public.manager_camp_version_v1(id)),'{}') into result from public.club_camps where club_id=any(p_club_ids) and id=p_camp;
  return result;
end $$;
revoke all on function public.get_manager_camp_versions_v1(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.get_manager_camp_versions_v1(uuid,uuid[],uuid) to service_role;

create or replace function public.save_manager_camp_v1(p_actor uuid,p_camp uuid,p_club uuid,p_expected_version text,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  camp public.club_camps%rowtype; old_day public.club_camp_days%rowtype; day jsonb; opt jsonb; reg jsonb; assignment jsonb;
  groups uuid[]; players uuid[]; coaches uuid[]; day_coaches uuid[]; head_coach uuid; season uuid; primary_group uuid;
  incoming_events uuid[]; removed uuid[]; kept_options uuid[] := '{}'; assignment_ids uuid[]; day_indexes int[];
  v_event_id uuid; v_option_id uuid; player uuid; start_time timestamptz; end_time timestamptz; v_day_index int := 0; pos int := 0;
  reg_status text; day_status text; input_kind text; v_choices jsonb; option_capacity int; quantity_sum int; inserted int;
  new_camp boolean := p_camp is null; days_result jsonb := '[]';
begin
  if new_camp then
    perform public.require_manager_club_scope_v1(p_actor,p_club);
    insert into public.club_camps(club_id,title,created_by,status) values(p_club,btrim(p_values->>'title'),p_actor,'draft') returning * into camp;
  else
    select * into camp from public.club_camps where id=p_camp for update;
    if not found then raise exception 'camp_not_found' using errcode='P0002'; end if;
    perform public.require_manager_club_scope_v1(p_actor,camp.club_id);
    -- Lock children before comparing the version. Player registration/option
    -- submissions which happened after opening the editor cause a safe conflict.
    perform 1 from public.club_events where id in(select d.event_id from public.club_camp_days d where camp_id=camp.id) order by id for update;
    perform 1 from public.club_camp_players where camp_id=camp.id for update;
    perform 1 from public.club_camp_options where camp_id=camp.id for update;
    perform 1 from public.club_camp_days where camp_id=camp.id for update;
    perform 1 from public.club_event_attendees where club_event_attendees.event_id in(select d.event_id from public.club_camp_days d where camp_id=camp.id) for update;
    perform 1 from public.club_camp_player_options where club_camp_player_options.option_id in(select o.id from public.club_camp_options o where camp_id=camp.id) for update;
    if p_expected_version is null or public.manager_camp_version_v1(camp.id)<>p_expected_version then
      raise exception 'camp_conflict' using errcode='40001';
    end if;
  end if;
  groups := array(select distinct value::uuid from jsonb_array_elements_text(p_values->'group_ids'));
  players := array(select distinct value::uuid from jsonb_array_elements_text(p_values->'player_ids'));
  head_coach := nullif(p_values->>'head_coach_user_id','')::uuid;
  season := nullif(p_values->>'season_id','')::uuid;
  coaches := array(select distinct x from (
    select value::uuid x from jsonb_array_elements_text(p_values->'coach_ids')
    union select head_coach union select nullif(d->>'responsible_coach_id','')::uuid from jsonb_array_elements(p_values->'days') d
    union select c.value::uuid from jsonb_array_elements(p_values->'days') d cross join lateral jsonb_array_elements_text(d->'coach_ids') c) c where x is not null);
  if nullif(btrim(p_values->>'title'),'') is null or p_values->>'status' not in ('draft','scheduled','cancelled')
    or jsonb_typeof(p_values->'days') is distinct from 'array' or jsonb_array_length(p_values->'days')>80
    or (p_values->>'status'<>'draft' and (head_coach is null or (cardinality(groups)=0 and cardinality(players)=0) or jsonb_array_length(p_values->'days')=0))
    or (jsonb_array_length(p_values->'days')>0 and head_coach is null) then raise exception 'invalid_camp' using errcode='22023'; end if;
  if season is not null and not exists(select 1 from public.club_seasons where id=season and club_id=camp.club_id) then raise exception 'invalid_season' using errcode='22023'; end if;
  if exists(select 1 from unnest(groups) x where not exists(select 1 from public.coach_groups g where g.id=x and g.club_id=camp.club_id
    and (season is null or g.club_season_id is null or g.club_season_id=season)))
    or exists(select 1 from unnest(players) x where not exists(select 1 from public.club_members m where m.club_id=camp.club_id and m.user_id=x and m.role='player' and m.is_active)
      and not exists(select 1 from public.club_camp_players cp where cp.camp_id=camp.id and cp.player_id=x))
    or exists(select 1 from unnest(coaches) x where not exists(select 1 from public.club_members m where m.club_id=camp.club_id and m.user_id=x and m.role in ('coach','manager') and m.is_active)
      and not exists(select 1 from public.club_camp_coaches cc where cc.camp_id=camp.id and cc.coach_id=x)) then
    raise exception 'invalid_assignments' using errcode='22023';
  end if;
  incoming_events := array(select nullif(d->>'event_id','')::uuid from jsonb_array_elements(p_values->'days') d where nullif(d->>'event_id','') is not null);
  if cardinality(incoming_events)<>(select count(distinct x) from unnest(incoming_events) x)
    or exists(select 1 from unnest(incoming_events) x where not exists(select 1 from public.club_camp_days d where d.camp_id=camp.id and d.event_id=x)) then
    raise exception 'invalid_days' using errcode='22023';
  end if;
  removed := array(select cp.player_id from public.club_camp_players cp where cp.camp_id=camp.id and not(cp.player_id=any(players)));
  if exists(select 1 from public.club_camp_days d join public.club_events e on e.id=d.event_id where d.camp_id=camp.id and (
      exists(select 1 from public.club_event_attendees a where a.event_id=e.id and a.player_id=any(removed)
        and (coalesce(e.ends_at,e.starts_at)<now() or a.coach_recorded_status is not null or a.status in ('absent','excused','present')))
      or exists(select 1 from public.club_event_coach_feedback f where f.event_id=e.id and f.player_id=any(removed))
      or exists(select 1 from public.club_event_player_feedback f where f.event_id=e.id and f.player_id=any(removed))
      or exists(select 1 from public.club_event_evaluation_responses f where f.event_id=e.id and f.player_id=any(removed))
      or exists(select 1 from public.club_event_player_structure_items f where f.event_id=e.id and f.player_id=any(removed))
      or exists(select 1 from public.coach_player_private_notes f where f.event_id=e.id and f.player_id=any(removed))))
    or exists(select 1 from public.club_camp_player_options po join public.club_camp_options o on o.id=po.option_id where o.camp_id=camp.id and po.player_id=any(removed)) then
    raise exception 'camp_history_removal' using errcode='23000';
  end if;
  for old_day in select * from public.club_camp_days d where d.camp_id=camp.id and not(d.event_id=any(incoming_events)) loop
    if exists(select 1 from public.club_event_attendees a where a.event_id=old_day.event_id and (a.coach_recorded_status is not null or a.status in ('present','absent','excused')))
      or exists(select 1 from public.club_event_coach_feedback f where f.event_id=old_day.event_id)
      or exists(select 1 from public.club_event_player_feedback f where f.event_id=old_day.event_id)
      or exists(select 1 from public.club_event_evaluation_responses f where f.event_id=old_day.event_id)
      or exists(select 1 from public.club_event_player_structure_items f where f.event_id=old_day.event_id)
      or exists(select 1 from public.coach_player_private_notes f where f.event_id=old_day.event_id)
      or exists(select 1 from public.message_threads f where f.event_id=old_day.event_id)
      or exists(select 1 from public.club_camp_option_days f where f.camp_day_id=old_day.id)
      or exists(select 1 from public.training_sessions f where f.club_event_id=old_day.event_id) then
      raise exception 'camp_history_removal' using errcode='23000';
    end if;
    -- Keep the event and any overlooked dependencies; cancel instead of deleting.
    update public.club_events set status='cancelled' where id=old_day.event_id;
    delete from public.club_camp_days where id=old_day.id;
  end loop;
  if cardinality(groups)=0 and jsonb_array_length(p_values->'days')>0 then
    insert into public.coach_groups(club_id,club_season_id,name,is_active,head_coach_user_id)
      values(camp.club_id,season,'Groupe spécifique',true,head_coach) returning id into primary_group;
    groups := array[primary_group];
    insert into public.coach_group_players(group_id,player_user_id) select primary_group,x from unnest(players) x;
    insert into public.coach_group_coaches(group_id,coach_user_id,is_head) select primary_group,x,x=head_coach from unnest(coaches) x;
  else primary_group := groups[1]; end if;
  update public.club_camps set title=btrim(p_values->>'title'),notes=nullif(p_values->>'notes',''),image_url=nullif(p_values->>'image_url',''),
    capacity=(p_values->>'capacity')::int,head_coach_user_id=head_coach,season_id=season,status=p_values->>'status',archived_at=null,
    participants_snapshot_at=case when cardinality(players)>0 then now() else null end,updated_at=now() where id=camp.id;
  delete from public.club_camp_groups where camp_id=camp.id and not(group_id=any(groups));
  insert into public.club_camp_groups(camp_id,group_id) select camp.id,x from unnest(groups) x on conflict do nothing;
  delete from public.club_camp_coaches where camp_id=camp.id and not(coach_id=any(coaches));
  insert into public.club_camp_coaches(camp_id,coach_id,is_head) select camp.id,x,x=head_coach from unnest(coaches) x
    on conflict(camp_id,coach_id) do update set is_head=excluded.is_head;
  delete from public.club_camp_players where camp_id=camp.id and player_id=any(removed);
  insert into public.club_camp_players(camp_id,player_id,registration_status) select camp.id,x,'invited' from unnest(players) x on conflict do nothing;
  for reg in select value from jsonb_array_elements(p_values->'player_registrations') loop
    player := (reg->>'player_id')::uuid; reg_status := reg->>'registration_status';
    if not(player=any(players)) or reg_status not in ('invited','registered','declined') then raise exception 'invalid_registration' using errcode='22023'; end if;
    update public.club_camp_players set registration_status=reg_status,
      registered_at=case when reg_status='registered' then coalesce(registered_at,now()) else null end
      where camp_id=camp.id and player_id=player;
  end loop;
  -- Reordering keeps both day and event IDs; negative indexes are transactional.
  update public.club_camp_days d set day_index=-100000-d.day_index where d.camp_id=camp.id;
  for day in select value from jsonb_array_elements(p_values->'days') loop
    v_event_id := nullif(day->>'event_id','')::uuid;
    start_time := (day->>'starts_at')::timestamptz; end_time := (day->>'ends_at')::timestamptz;
    if start_time is null or end_time is null or end_time<=start_time then raise exception 'invalid_days' using errcode='22023'; end if;
    day_coaches := array(select distinct x from (select head_coach x union select nullif(day->>'responsible_coach_id','')::uuid
      union select value::uuid from jsonb_array_elements_text(day->'coach_ids')) q where x is not null);
    if v_event_id is null then
      insert into public.club_events(club_id,group_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,status,requires_evaluation,created_by)
        values(camp.club_id,primary_group,'camp',btrim(p_values->>'title'),start_time,end_time,least(300,round(extract(epoch from(end_time-start_time))/60)::int),
          nullif(day->>'location_text',''),nullif(day->>'practical_info',''),'scheduled',coalesce((day->>'evaluation_enabled')::boolean,false),p_actor) returning id into v_event_id;
      insert into public.club_camp_days(camp_id,event_id,day_index) values(camp.id,v_event_id,v_day_index);
      old_day := null;
    else
      select * into old_day from public.club_camp_days d where d.event_id=v_event_id and d.camp_id=camp.id;
      update public.club_events e set group_id=primary_group,title=btrim(p_values->>'title'),starts_at=start_time,ends_at=end_time,
        duration_minutes=least(300,round(extract(epoch from(end_time-start_time))/60)::int),location_text=nullif(day->>'location_text',''),
        coach_note=nullif(day->>'practical_info',''),requires_evaluation=coalesce((day->>'evaluation_enabled')::boolean,false) where e.id=v_event_id;
    end if;
    update public.club_camp_days d set day_index=v_day_index,starts_at=start_time,ends_at=end_time,location_text=nullif(day->>'location_text',''),
      practical_info=nullif(day->>'practical_info',''),responsible_coach_id=coalesce(nullif(day->>'responsible_coach_id','')::uuid,head_coach),
      evaluation_enabled=coalesce((day->>'evaluation_enabled')::boolean,false),updated_at=now() where d.event_id=v_event_id and d.camp_id=camp.id;
    delete from public.club_event_coaches ec where ec.event_id=v_event_id and not(ec.coach_id=any(day_coaches));
    insert into public.club_event_coaches(event_id,coach_id) select v_event_id,x from unnest(day_coaches) x on conflict do nothing;
    -- Retained rows preserve coach_recorded_* and RSVP metadata. Only explicit
    -- registration/day choices change status; historical days remain untouched.
    if old_day.id is null or coalesce(old_day.ends_at,old_day.starts_at)>=now() then
      delete from public.club_event_attendees a where a.event_id=v_event_id and a.player_id=any(removed);
      foreach player in array players loop
        select value into reg from jsonb_array_elements(p_values->'player_registrations') where value->>'player_id'=player::text;
        select cp.registration_status into reg_status from public.club_camp_players cp where cp.camp_id=camp.id and cp.player_id=player;
        day_status := reg#>>array['day_status_by_day_index',v_day_index::text];
        if day_status is not null and day_status not in ('expected','present','absent','excused','not_registered') then raise exception 'invalid_attendance' using errcode='22023'; end if;
        if reg_status<>'registered' then day_status := 'not_registered'; end if;
        insert into public.club_event_attendees(event_id,player_id,status) values(v_event_id,player,coalesce(day_status,'expected'))
          on conflict(event_id,player_id) do nothing;
        get diagnostics inserted=row_count;
        -- The legacy BEFORE INSERT trigger defaults camp rows to not_registered.
        -- Restore the explicit manager choice only after insertion; keep all
        -- metadata on retained rows and never reset an unspecified existing RSVP.
        if inserted=1 or day_status is not null then
          update public.club_event_attendees a set status=coalesce(day_status,'expected') where a.event_id=v_event_id and a.player_id=player;
        end if;
      end loop;
    end if;
    perform public.manager_sync_event_criteria_v1(v_event_id,case when coalesce((day->>'evaluation_enabled')::boolean,false)
      then array(select value::uuid from jsonb_array_elements_text(day->'evaluation_criterion_ids')) else '{}'::uuid[] end);
    days_result := days_result || jsonb_build_array(jsonb_build_object('event_id',v_event_id,'day_index',v_day_index));
    v_day_index := v_day_index+1;
  end loop;
  for opt in select value from jsonb_array_elements(p_values->'options') loop
    v_option_id := nullif(opt->>'id','')::uuid;
    if v_option_id is not null and (v_option_id=any(kept_options) or not exists(select 1 from public.club_camp_options o where o.id=v_option_id and o.camp_id=camp.id)) then
      raise exception 'invalid_option' using errcode='22023';
    end if;
    input_kind := coalesce(opt->>'input_type','checkbox'); v_choices := coalesce(opt->'choices','[]'); option_capacity := (opt->>'capacity')::int;
    if nullif(btrim(opt->>'name'),'') is null or input_kind not in ('checkbox','yes_no','select','radio')
      or jsonb_typeof(v_choices)<>'array' or (input_kind in ('select','radio') and jsonb_array_length(v_choices)<2) then raise exception 'invalid_option' using errcode='22023'; end if;
    assignment_ids := array(select (x->>'player_id')::uuid from jsonb_array_elements(opt->'player_assignments') x);
    if cardinality(assignment_ids)<>(select count(distinct x) from unnest(assignment_ids) x) or not(assignment_ids<@players) then raise exception 'invalid_option_assignment' using errcode='22023'; end if;
    select coalesce(sum(coalesce((x->>'quantity')::int,1)),0) into quantity_sum from jsonb_array_elements(opt->'player_assignments') x;
    if option_capacity is not null and quantity_sum>option_capacity then raise exception 'option_capacity' using errcode='22023'; end if;
    day_indexes := array(select value::int from jsonb_array_elements_text(opt->'day_indexes'));
    if coalesce((opt->>'applies_to_all_days')::boolean,true)=false and (cardinality(day_indexes)=0 or exists(select 1 from unnest(day_indexes) x where x<0 or x>=v_day_index)) then raise exception 'invalid_option_days' using errcode='22023'; end if;
    if v_option_id is null then
      insert into public.club_camp_options(camp_id,name) values(camp.id,btrim(opt->>'name')) returning id into v_option_id;
    end if;
    update public.club_camp_options o set name=btrim(opt->>'name'),description=nullif(opt->>'description',''),
      is_active=coalesce((opt->>'is_active')::boolean,true),applies_to_all_days=coalesce((opt->>'applies_to_all_days')::boolean,true),
      capacity=option_capacity,allows_quantity=input_kind='checkbox' and jsonb_array_length(v_choices)=0 and coalesce((opt->>'allows_quantity')::boolean,false),
      input_type=input_kind,choices=v_choices,internal_note=nullif(opt->>'internal_note',''),sort_order=pos,updated_at=now() where o.id=v_option_id;
    delete from public.club_camp_option_days od where od.option_id=v_option_id;
    if coalesce((opt->>'applies_to_all_days')::boolean,true)=false then
      insert into public.club_camp_option_days(option_id,camp_day_id) select v_option_id,d.id from public.club_camp_days d where d.camp_id=camp.id and d.day_index=any(day_indexes);
    end if;
    delete from public.club_camp_player_options po where po.option_id=v_option_id and not(po.player_id=any(assignment_ids));
    for assignment in select value from jsonb_array_elements(opt->'player_assignments') loop
      insert into public.club_camp_player_options(option_id,player_id,quantity,note,selected_value,assigned_by)
        values(v_option_id,(assignment->>'player_id')::uuid,coalesce((assignment->>'quantity')::int,1),nullif(assignment->>'note',''),nullif(assignment->>'selected_value',''),p_actor)
        on conflict(option_id,player_id) do update set quantity=excluded.quantity,note=excluded.note,selected_value=excluded.selected_value,
          updated_at=case when row(club_camp_player_options.quantity,club_camp_player_options.note,club_camp_player_options.selected_value)
            is distinct from row(excluded.quantity,excluded.note,excluded.selected_value) then now() else club_camp_player_options.updated_at end;
    end loop;
    kept_options := array_append(kept_options,v_option_id); pos := pos+1;
  end loop;
  -- Removed options with existing answers are archived with answers intact.
  update public.club_camp_options o set is_active=false,updated_at=now() where o.camp_id=camp.id and not(o.id=any(kept_options));
  return jsonb_build_object('ok',true,'camp_id',camp.id,'days',days_result);
end $$;
revoke all on function public.save_manager_camp_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_manager_camp_v1(uuid,uuid,uuid,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
