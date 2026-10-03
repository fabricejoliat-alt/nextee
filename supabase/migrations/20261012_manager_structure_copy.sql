-- Copy planned structures as one transaction, with the same Manager scope and
-- optimistic snapshot protection as the occurrence/series editor (20261009).
begin;

create or replace function public.copy_manager_event_structure_v1(p_event_id uuid, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  source public.club_events%rowtype;
  series public.club_event_series%rowtype;
  expected_targets jsonb;
  actual_targets jsonb;
  target_ids uuid[];
  source_structure jsonb;
  target_id uuid;
  item jsonb;
  source_series uuid;
begin
  select * into source from public.club_events where id=p_event_id;
  if not found then raise exception 'event_not_found' using errcode='P0002'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),source.club_id);
  if source.series_id is null then raise exception 'series_not_found' using errcode='P0002'; end if;
  source_series := source.series_id;
  select * into series from public.club_event_series where id=source_series for update;
  if not found or series.club_id is distinct from source.club_id or series.group_id is distinct from source.group_id then
    raise exception 'forbidden' using errcode='42501';
  end if;
  -- Follow the series editor lock order. Individual saves also lock their event.
  perform 1 from public.club_events where series_id=source_series or id=p_event_id order by starts_at,id for update;
  select * into source from public.club_events where id=p_event_id;
  if source.series_id is distinct from source_series or source.club_id is distinct from series.club_id
    or source.group_id is distinct from series.group_id then raise exception 'planning_conflict' using errcode='40001'; end if;
  if source.event_type not in ('training','camp') then raise exception 'invalid_structure' using errcode='22023'; end if;
  if p_expected is null or jsonb_typeof(p_expected->'future') is distinct from 'array'
    or public.manager_event_snapshot_v1(source.id) is distinct from (p_expected-'series'-'future')
    or to_jsonb(series) is distinct from p_expected->'series' then
    raise exception 'planning_conflict' using errcode='40001';
  end if;
  source_structure := p_expected->'structure';
  if jsonb_typeof(source_structure) is distinct from 'array' or jsonb_array_length(source_structure)=0
    or jsonb_array_length(source_structure)>100 then raise exception 'invalid_structure' using errcode='22023'; end if;

  select coalesce(array_agg(e.id order by e.starts_at,e.id),'{}') into target_ids
    from public.club_events e where e.series_id=source_series and e.starts_at>source.starts_at
      and e.starts_at>=now() and e.status='scheduled';
  -- A corrupted cross-club/other-type series must never widen the write scope.
  if exists(select 1 from public.club_events e where e.id=any(target_ids)
    and (e.club_id is distinct from source.club_id or e.group_id is distinct from source.group_id
      or e.event_type is distinct from source.event_type)) then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.club_event_structure_items where event_id=source.id or event_id=any(target_ids) for update;
  -- Check again after acquiring structure locks to catch a concurrent direct edit.
  if public.manager_event_snapshot_v1(source.id) is distinct from (p_expected-'series'-'future') then
    raise exception 'planning_conflict' using errcode='40001';
  end if;
  select coalesce(jsonb_agg(x order by (x->'event'->>'starts_at')::timestamptz,x->'event'->>'id'),'[]') into expected_targets
    from jsonb_array_elements(p_expected->'future') x
    where (x->'event'->>'starts_at')::timestamptz>source.starts_at
      and (x->'event'->>'starts_at')::timestamptz>=now() and x->'event'->>'status'='scheduled';
  select coalesce(jsonb_agg(public.manager_event_snapshot_v1(e.id) order by e.starts_at,e.id),'[]') into actual_targets
    from public.club_events e where e.id=any(target_ids);
  if actual_targets is distinct from expected_targets then raise exception 'planning_conflict' using errcode='40001'; end if;

  -- Any insertion error rolls back every replacement, including earlier targets.
  delete from public.club_event_structure_items where event_id=any(target_ids);
  foreach target_id in array target_ids loop
    for item in select * from jsonb_array_elements(source_structure) loop
      insert into public.club_event_structure_items(event_id,category,minutes,note,position)
        values(target_id,item->>'category',(item->>'minutes')::integer,item->>'note',(item->>'position')::integer);
    end loop;
  end loop;
  return jsonb_build_object('copied',cardinality(target_ids));
end $$;
revoke all on function public.copy_manager_event_structure_v1(uuid,jsonb) from public,anon;
grant execute on function public.copy_manager_event_structure_v1(uuid,jsonb) to authenticated;

commit;
