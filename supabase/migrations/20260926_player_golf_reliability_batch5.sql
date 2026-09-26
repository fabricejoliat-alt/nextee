-- Batch 5: acknowledge Player golf saves only after every related database
-- mutation has completed. All functions re-check round ownership because they
-- run as SECURITY DEFINER and therefore do not rely on caller-side filtering.

create or replace function public.save_player_golf_hole_transactional(
  p_round_id uuid,
  p_hole jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.golf_rounds%rowtype;
  v_hole public.golf_round_holes%rowtype;
  v_hole_id uuid;
begin
  if v_actor_id is null or p_round_id is null or p_hole is null then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select gr.*
  into v_round
  from public.golf_rounds gr
  where gr.id = p_round_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if v_round.user_id is distinct from v_actor_id and not exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = v_round.user_id
      and pg.guardian_user_id = v_actor_id
      and coalesce(pg.can_view, true) = true
      and coalesce(pg.can_edit, false) = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id and cm.role = 'player' and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_MEMBERSHIP_REQUIRED';
  end if;
  if exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id
      and cm.role = 'player'
      and cm.is_active = true
      and coalesce(cm.player_consent_status, 'pending') not in ('granted', 'adult')
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_CONSENT_REQUIRED';
  end if;
  if v_round.om_organization_id is not null and not exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id
      and cm.club_id = v_round.om_organization_id
      and cm.role = 'player'
      and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  v_hole := jsonb_populate_record(null::public.golf_round_holes, p_hole);
  if v_hole.hole_no is null or v_hole.hole_no < 1 or v_hole.hole_no > 18 then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLE_PAYLOAD';
  end if;
  if v_hole.par is not null and (v_hole.par < 1 or v_hole.par > 7) then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLE_PAYLOAD';
  end if;
  if v_hole.score is not null and (v_hole.score < 0 or v_hole.score > 30) then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLE_PAYLOAD';
  end if;
  if v_hole.putts is not null and (
    v_hole.putts < 0
    or v_hole.putts > 10
    or (v_hole.score is not null and v_hole.putts > v_hole.score)
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLE_PAYLOAD';
  end if;

  insert into public.golf_round_holes (
    round_id,
    hole_no,
    par,
    stroke_index,
    score,
    putts,
    fairway_hit,
    note
  ) values (
    p_round_id,
    v_hole.hole_no,
    v_hole.par,
    v_hole.stroke_index,
    v_hole.score,
    v_hole.putts,
    v_hole.fairway_hit,
    nullif(trim(v_hole.note), '')
  )
  on conflict (round_id, hole_no) do update set
    par = excluded.par,
    stroke_index = excluded.stroke_index,
    score = excluded.score,
    putts = excluded.putts,
    fairway_hit = excluded.fairway_hit,
    note = excluded.note
  returning id into v_hole_id;

  perform public.om_recompute_round(p_round_id);

  return jsonb_build_object(
    'ok', true,
    'hole_id', v_hole_id,
    'hole_no', v_hole.hole_no
  );
end;
$$;

revoke all on function public.save_player_golf_hole_transactional(uuid, jsonb) from public, anon;
grant execute on function public.save_player_golf_hole_transactional(uuid, jsonb) to authenticated;

create or replace function public.save_player_golf_holes_transactional(
  p_round_id uuid,
  p_holes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.golf_rounds%rowtype;
  v_hole_count integer;
  v_distinct_hole_count integer;
  v_min_hole integer;
  v_max_hole integer;
begin
  if v_actor_id is null or p_round_id is null or jsonb_typeof(p_holes) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select gr.*
  into v_round
  from public.golf_rounds gr
  where gr.id = p_round_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if v_round.user_id is distinct from v_actor_id and not exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = v_round.user_id
      and pg.guardian_user_id = v_actor_id
      and coalesce(pg.can_view, true) = true
      and coalesce(pg.can_edit, false) = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id and cm.role = 'player' and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_MEMBERSHIP_REQUIRED';
  end if;
  if exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id
      and cm.role = 'player'
      and cm.is_active = true
      and coalesce(cm.player_consent_status, 'pending') not in ('granted', 'adult')
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_CONSENT_REQUIRED';
  end if;
  if v_round.om_organization_id is not null and not exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id
      and cm.club_id = v_round.om_organization_id
      and cm.role = 'player'
      and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select
    count(*)::integer,
    count(distinct hole_no)::integer,
    min(hole_no),
    max(hole_no)
  into v_hole_count, v_distinct_hole_count, v_min_hole, v_max_hole
  from jsonb_to_recordset(p_holes) as h(hole_no integer);

  if v_hole_count not in (9, 18)
    or v_distinct_hole_count <> v_hole_count
    or v_min_hole <> 1
    or v_max_hole <> v_hole_count
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_holes) as h(
      hole_no integer,
      par integer,
      score integer,
      putts integer
    )
    where (h.par is not null and (h.par < 1 or h.par > 7))
      or (h.score is not null and (h.score < 0 or h.score > 30))
      or (h.putts is not null and (
        h.putts < 0
        or h.putts > 10
        or (h.score is not null and h.putts > h.score)
      ))
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLE_PAYLOAD';
  end if;

  insert into public.golf_round_holes (
    round_id,
    hole_no,
    par,
    stroke_index,
    score,
    putts,
    fairway_hit,
    note
  )
  select
    p_round_id,
    h.hole_no,
    h.par,
    h.stroke_index,
    h.score,
    h.putts,
    h.fairway_hit,
    nullif(trim(h.note), '')
  from jsonb_to_recordset(p_holes) as h(
    hole_no integer,
    par integer,
    stroke_index integer,
    score integer,
    putts integer,
    fairway_hit boolean,
    note text
  )
  on conflict (round_id, hole_no) do update set
    par = excluded.par,
    stroke_index = excluded.stroke_index,
    score = excluded.score,
    putts = excluded.putts,
    fairway_hit = excluded.fairway_hit,
    note = excluded.note;

  perform public.om_recompute_round(p_round_id);

  return jsonb_build_object(
    'ok', true,
    'round_id', p_round_id,
    'hole_count', v_hole_count
  );
end;
$$;

revoke all on function public.save_player_golf_holes_transactional(uuid, jsonb) from public, anon;
grant execute on function public.save_player_golf_holes_transactional(uuid, jsonb) to authenticated;

create or replace function public.update_player_golf_round_transactional(
  p_round_id uuid,
  p_start_at timestamptz,
  p_notes text,
  p_competition_level text,
  p_rounds_18_count smallint,
  p_tee_name text,
  p_slope_rating integer,
  p_course_rating numeric,
  p_target_hole_count integer,
  p_holes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.golf_rounds%rowtype;
  v_hole_count integer;
  v_distinct_hole_count integer;
  v_min_hole integer;
  v_max_hole integer;
begin
  if v_actor_id is null or p_round_id is null then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select gr.*
  into v_round
  from public.golf_rounds gr
  where gr.id = p_round_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if v_round.user_id is distinct from v_actor_id and not exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = v_round.user_id
      and pg.guardian_user_id = v_actor_id
      and coalesce(pg.can_view, true) = true
      and coalesce(pg.can_edit, false) = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id and cm.role = 'player' and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_MEMBERSHIP_REQUIRED';
  end if;
  if exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id
      and cm.role = 'player'
      and cm.is_active = true
      and coalesce(cm.player_consent_status, 'pending') not in ('granted', 'adult')
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_CONSENT_REQUIRED';
  end if;
  if v_round.om_organization_id is not null and not exists (
    select 1 from public.club_members cm
    where cm.user_id = v_round.user_id
      and cm.club_id = v_round.om_organization_id
      and cm.role = 'player'
      and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if p_start_at is null
    or p_target_hole_count is null
    or p_target_hole_count not in (9, 18)
    or jsonb_typeof(p_holes) is distinct from 'array'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
  end if;

  select
    count(*)::integer,
    count(distinct hole_no)::integer,
    min(hole_no),
    max(hole_no)
  into v_hole_count, v_distinct_hole_count, v_min_hole, v_max_hole
  from jsonb_to_recordset(p_holes) as h(hole_no integer);

  if v_hole_count <> p_target_hole_count
    or v_distinct_hole_count <> p_target_hole_count
    or v_min_hole <> 1
    or v_max_hole <> p_target_hole_count
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_holes) as h(
      hole_no integer,
      par integer,
      score integer,
      putts integer
    )
    where (h.par is not null and (h.par < 1 or h.par > 7))
      or (h.score is not null and (h.score < 0 or h.score > 30))
      or (h.putts is not null and (
        h.putts < 0
        or h.putts > 10
        or (h.score is not null and h.putts > h.score)
      ))
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLE_PAYLOAD';
  end if;

  update public.golf_rounds gr
  set
    start_at = p_start_at,
    notes = nullif(trim(p_notes), ''),
    om_competition_level = p_competition_level,
    om_rounds_18_count = p_rounds_18_count,
    tee_name = nullif(trim(p_tee_name), ''),
    slope_rating = p_slope_rating,
    course_rating = p_course_rating
  where gr.id = p_round_id;

  delete from public.golf_round_holes gh
  where gh.round_id = p_round_id
    and gh.hole_no > p_target_hole_count;

  insert into public.golf_round_holes (
    round_id,
    hole_no,
    par,
    stroke_index,
    score,
    putts,
    fairway_hit,
    note
  )
  select
    p_round_id,
    h.hole_no,
    h.par,
    h.stroke_index,
    h.score,
    h.putts,
    h.fairway_hit,
    nullif(trim(h.note), '')
  from jsonb_to_recordset(p_holes) as h(
    hole_no integer,
    par integer,
    stroke_index integer,
    score integer,
    putts integer,
    fairway_hit boolean,
    note text
  )
  on conflict (round_id, hole_no) do update set
    par = excluded.par,
    stroke_index = excluded.stroke_index,
    score = excluded.score,
    putts = excluded.putts,
    fairway_hit = excluded.fairway_hit,
    note = excluded.note;

  perform public.om_recompute_round(p_round_id);

  return jsonb_build_object(
    'ok', true,
    'round_id', p_round_id,
    'hole_count', p_target_hole_count
  );
end;
$$;

revoke all on function public.update_player_golf_round_transactional(
  uuid, timestamptz, text, text, smallint, text, integer, numeric, integer, jsonb
) from public, anon;
grant execute on function public.update_player_golf_round_transactional(
  uuid, timestamptz, text, text, smallint, text, integer, numeric, integer, jsonb
) to authenticated;
