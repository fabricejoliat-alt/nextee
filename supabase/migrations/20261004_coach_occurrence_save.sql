-- One occurrence is saved as one transaction. No attendance/evaluation reset.
-- Apply after the Coach security/reliability migrations; never fall back to
-- browser-side delete/reinsert if this RPC is not installed.
begin;

create or replace function public.update_coach_event_occurrence_v1(
  p_event_id uuid, p_expected jsonb, p_changes jsonb,
  p_coach_ids uuid[], p_player_ids uuid[], p_structure jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event public.club_events%rowtype;
  v_expected jsonb := p_expected->'event';
  v_type text := p_changes->>'event_type';
  v_start timestamptz := (p_changes->>'starts_at')::timestamptz;
  v_end timestamptz := (p_changes->>'ends_at')::timestamptz;
  v_duration int := (p_changes->>'duration_minutes')::int;
  v_ids uuid[];
  v_expected_ids uuid[];
  v_structure jsonb;
  v_expected_structure jsonb;
  v_item jsonb;
  v_position int := 0;
  v_recipients uuid[];
begin
  select * into v_event from public.club_events where id = p_event_id for update;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  if auth.uid() is null or not public.can_manage_assigned_group(v_event.group_id, auth.uid(), 'planning')
    or not exists(select 1 from public.coach_groups where id = v_event.group_id and club_id = v_event.club_id)
    then raise exception 'forbidden'; end if;
  if v_event.status = 'cancelled' then raise exception 'event_cancelled'; end if;
  if v_event.event_type = 'competition' then raise exception 'use_competition_editor'; end if;
  if (v_event.event_type = 'camp') is distinct from (v_type = 'camp') then raise exception 'use_camp_editor'; end if;
  if v_type is null or v_type not in ('training','interclub','camp','session','event')
    or v_start is null or v_end is null or v_end <= v_start
    or v_duration is null or v_duration not between 1 and 300
    or v_duration <> least(300, round(extract(epoch from (v_end - v_start)) / 60)::int)
    then raise exception 'invalid_event'; end if;
  if v_type in ('session','camp','event') and nullif(btrim(p_changes->>'title'),'') is null
    then raise exception 'title_required'; end if;
  if length(coalesce(p_changes->>'title','')) > 500 or length(coalesce(p_changes->>'location_text','')) > 2000
    or length(coalesce(p_changes->>'coach_note','')) > 10000 then raise exception 'invalid_event'; end if;
  if p_expected is null or jsonb_typeof(v_expected) is distinct from 'object'
    or jsonb_typeof(p_expected->'coach_ids') is distinct from 'array'
    or jsonb_typeof(p_expected->'player_ids') is distinct from 'array'
    or jsonb_typeof(p_expected->'structure') is distinct from 'array' then raise exception 'planning_conflict'; end if;

  -- Compare the data actually loaded by the form, not a token obtained after it.
  -- Attendance may evolve independently: it is neither overwritten nor compared.
  if row(v_event.group_id,v_event.club_id,v_event.series_id,v_event.status,v_event.event_type,v_event.title,
      v_event.starts_at,v_event.ends_at,v_event.duration_minutes,v_event.location_text,v_event.coach_note)
    is distinct from row((v_expected->>'group_id')::uuid,(v_expected->>'club_id')::uuid,(v_expected->>'series_id')::uuid,
      v_expected->>'status',v_expected->>'event_type',v_expected->>'title',
      (v_expected->>'starts_at')::timestamptz,(v_expected->>'ends_at')::timestamptz,
      (v_expected->>'duration_minutes')::int,v_expected->>'location_text',v_expected->>'coach_note')
    then raise exception 'planning_conflict'; end if;
  perform 1 from public.club_event_coaches where event_id = p_event_id for update;
  perform 1 from public.club_event_attendees where event_id = p_event_id for update;
  perform 1 from public.club_event_structure_items where event_id = p_event_id for update;
  select coalesce(array_agg(coach_id order by coach_id),'{}'::uuid[]) into v_ids from public.club_event_coaches where event_id=p_event_id;
  select coalesce(array_agg(distinct id::uuid order by id::uuid),'{}'::uuid[]) into v_expected_ids
    from jsonb_array_elements_text(p_expected->'coach_ids') u(id);
  if v_ids is distinct from v_expected_ids then raise exception 'planning_conflict'; end if;
  if v_event.event_type <> 'camp' then
    select coalesce(array_agg(player_id order by player_id),'{}'::uuid[]) into v_ids from public.club_event_attendees where event_id=p_event_id;
    select coalesce(array_agg(distinct id::uuid order by id::uuid),'{}'::uuid[]) into v_expected_ids
      from jsonb_array_elements_text(p_expected->'player_ids') u(id);
    if v_ids is distinct from v_expected_ids then raise exception 'planning_conflict'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(category,minutes,note,position) order by position,category,minutes,note),'[]')
    into v_structure from public.club_event_structure_items where event_id=p_event_id;
  select coalesce(jsonb_agg(jsonb_build_array(x->>'category',(x->>'minutes')::int,x->>'note',(x->>'position')::int)
    order by (x->>'position')::int,x->>'category',(x->>'minutes')::int,x->>'note'),'[]')
    into v_expected_structure from jsonb_array_elements(p_expected->'structure') x;
  if v_structure is distinct from v_expected_structure then raise exception 'planning_conflict'; end if;
  if v_event.event_type = 'camp' and (
    (nullif(p_expected->'camp_day','null'::jsonb) is not null) <> exists(select 1 from public.club_camp_days where event_id=p_event_id)
    or exists(select 1 from public.club_camp_days d where d.event_id=p_event_id
    and row(d.camp_id,d.day_index,d.starts_at,d.ends_at,d.location_text) is distinct from
      row((p_expected->'camp_day'->>'camp_id')::uuid,(p_expected->'camp_day'->>'day_index')::int,
        (p_expected->'camp_day'->>'starts_at')::timestamptz,(p_expected->'camp_day'->>'ends_at')::timestamptz,
        p_expected->'camp_day'->>'location_text'))) then raise exception 'planning_conflict'; end if;

  if p_coach_ids is null or cardinality(p_coach_ids) > 500 or cardinality(p_player_ids) > 2000
    or (v_event.event_type <> 'camp' and p_player_ids is null)
    or (v_event.event_type = 'camp' and p_player_ids is not null)
    or jsonb_typeof(p_structure) is distinct from 'array' or jsonb_array_length(p_structure) > 100
    then raise exception 'invalid_assignments'; end if;
  -- Historical members can be retained unchanged, but cannot be newly assigned.
  if exists(select 1 from unnest(p_coach_ids) u(id) where u.id is null or (
      not exists(select 1 from public.club_event_coaches c where c.event_id=p_event_id and c.coach_id=u.id)
      and not exists(select 1 from public.club_members m where m.club_id=v_event.club_id and m.user_id=u.id and m.is_active and m.role in ('coach','manager'))))
    or exists(select 1 from unnest(p_player_ids) u(id) where u.id is null or (
      not exists(select 1 from public.club_event_attendees a where a.event_id=p_event_id and a.player_id=u.id)
      and not exists(select 1 from public.club_members m where m.club_id=v_event.club_id and m.user_id=u.id and m.is_active)))
    then raise exception 'invalid_assignments'; end if;
  for v_item in select * from jsonb_array_elements(p_structure) loop
    if jsonb_typeof(v_item) <> 'object' or v_item->>'category' is null or v_item->>'category' not in
      ('warmup_mobility','long_game','short_game_all','putting','wedging','pitching','chipping','bunker','course','mental','fitness','other')
      or (v_item->>'minutes')::int is null or (v_item->>'minutes')::int not between 1 and 300
      or length(coalesce(v_item->>'note','')) > 10000 then raise exception 'invalid_structure'; end if;
  end loop;
  if p_player_ids is not null and exists(select 1 from public.club_event_attendees a
    where a.event_id=p_event_id and not(a.player_id=any(p_player_ids)) and (
      a.coach_recorded_status is not null
      or exists(select 1 from public.club_event_coach_feedback f where f.event_id=p_event_id and f.player_id=a.player_id)
      or exists(select 1 from public.club_event_evaluation_responses r where r.event_id=p_event_id and r.player_id=a.player_id)
      or exists(select 1 from public.club_event_player_structure_items i where i.event_id=p_event_id and i.player_id=a.player_id)
      or exists(select 1 from public.coach_player_private_notes n where n.event_id=p_event_id and n.player_id=a.player_id)))
    then raise exception 'evaluated_attendee_removal'; end if;

  update public.club_events set event_type=v_type,title=nullif(btrim(p_changes->>'title'),''),starts_at=v_start,ends_at=v_end,
    duration_minutes=v_duration,location_text=nullif(btrim(p_changes->>'location_text'),''),coach_note=nullif(btrim(p_changes->>'coach_note'),'')
    where id=p_event_id;
  if v_event.event_type='camp' then
    update public.club_camp_days set starts_at=v_start,ends_at=v_end,
      location_text=nullif(btrim(p_changes->>'location_text'),''),updated_at=now() where event_id=p_event_id;
  end if;
  delete from public.club_event_coaches where event_id=p_event_id and not(coach_id=any(p_coach_ids));
  insert into public.club_event_coaches(event_id,coach_id) select p_event_id,id from (select distinct unnest(p_coach_ids) id) u
    on conflict(event_id,coach_id) do nothing;
  if p_player_ids is not null then
    delete from public.club_event_attendees where event_id=p_event_id and not(player_id=any(p_player_ids));
    insert into public.club_event_attendees(event_id,player_id,status) select p_event_id,id,'present' from (select distinct unnest(p_player_ids) id) u
      on conflict(event_id,player_id) do nothing;
  end if;
  delete from public.club_event_structure_items where event_id=p_event_id;
  for v_item in select * from jsonb_array_elements(p_structure) loop
    insert into public.club_event_structure_items(event_id,category,minutes,note,position)
      values(p_event_id,v_item->>'category',(v_item->>'minutes')::int,nullif(btrim(v_item->>'note'),''),v_position);
    v_position := v_position + 1;
  end loop;
  select coalesce(array_agg(player_id),'{}'::uuid[]) into v_recipients from public.club_event_attendees a
    where a.event_id=p_event_id and coalesce(a.status,'expected') not in ('absent','excused')
      and coalesce(a.coach_recorded_status,'present') <> 'absent'
      and (v_event.event_type <> 'camp' or not exists(select 1 from public.club_camp_days where event_id=p_event_id)
        or exists(select 1 from public.club_camp_days d join public.club_camp_players p on p.camp_id=d.camp_id
          where d.event_id=p_event_id and p.player_id=a.player_id and p.registration_status='registered'));
  return jsonb_build_object('ok',true,'event_id',p_event_id,'recipient_ids',to_jsonb(v_recipients));
end;
$$;
revoke all on function public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb) from public,anon;
grant execute on function public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
