-- Fix round creation when round_type is backed by the public.golf_round_type enum.
-- trim(enum) is not defined by PostgreSQL, so the validation must cast to text first.

create or replace function public.create_player_golf_rounds_transactional(
  p_player_id uuid,
  p_round_payload jsonb,
  p_round_dates timestamptz[],
  p_holes jsonb default '[]'::jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.golf_rounds%rowtype;
  v_hole public.golf_round_holes%rowtype;
  v_hole_payload jsonb;
  v_round_id uuid;
  v_round_date timestamptz;
  v_round_ids uuid[] := array[]::uuid[];
begin
  if p_player_id is null or p_round_payload is null or jsonb_typeof(p_round_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
  end if;

  if v_actor_id is null or (
    v_actor_id <> p_player_id
    and not exists (
      select 1
      from public.player_guardians pg
      where pg.player_id = p_player_id
        and pg.guardian_user_id = v_actor_id
        and coalesce(pg.can_view, true) = true
        and coalesce(pg.can_edit, false) = true
    )
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.club_members cm
    where cm.user_id = p_player_id
      and cm.role = 'player'
      and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_MEMBERSHIP_REQUIRED';
  end if;

  if p_round_dates is null
    or coalesce(array_length(p_round_dates, 1), 0) not between 1 and 4
    or array_position(p_round_dates, null) is not null
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_DATES';
  end if;

  if p_holes is null or jsonb_typeof(p_holes) <> 'array' or jsonb_array_length(p_holes) > 18 then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLES_PAYLOAD';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_holes) hole
    where jsonb_typeof(hole.value) <> 'object'
      or nullif(hole.value ->> 'hole_no', '') is null
      or (hole.value ->> 'hole_no')::integer not between 1 and 18
  ) or (
    select count(*)
    from (
      select hole.value ->> 'hole_no'
      from jsonb_array_elements(p_holes) hole
      group by hole.value ->> 'hole_no'
      having count(*) > 1
    ) duplicates
  ) > 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLES_PAYLOAD';
  end if;

  v_round := jsonb_populate_record(null::public.golf_rounds, p_round_payload);

  if coalesce(trim(v_round.round_type::text), '') not in ('training', 'competition')
    or (
      v_round.round_type = 'competition'
      and v_round.om_competition_format = 'stroke_play_individual'
      and v_round.om_rounds_18_count is distinct from array_length(p_round_dates, 1)
    )
    or (
      coalesce(array_length(p_round_dates, 1), 0) > 1
      and not (
        v_round.round_type = 'competition'
        and v_round.om_competition_format = 'stroke_play_individual'
      )
    )
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
  end if;

  if v_round.om_organization_id is not null and not exists (
    select 1
    from public.club_members cm
    where cm.user_id = p_player_id
      and cm.club_id = v_round.om_organization_id
      and cm.role = 'player'
      and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  foreach v_round_date in array p_round_dates
  loop
    insert into public.golf_rounds (
      user_id,
      location,
      round_type,
      competition_name,
      handicap_start,
      course_source,
      course_name,
      external_course_id,
      tee_name,
      slope_rating,
      course_rating,
      match_opponent_handicap,
      om_match_result,
      match_score_text,
      notes,
      om_organization_id,
      om_competition_level,
      om_competition_format,
      om_rounds_18_count,
      score_entry_mode,
      om_match_play_wins,
      om_is_exceptional,
      om_exceptional_tournament_id,
      om_stats_submitted_at,
      start_at
    ) values (
      p_player_id,
      v_round.location,
      v_round.round_type,
      v_round.competition_name,
      v_round.handicap_start,
      v_round.course_source,
      v_round.course_name,
      v_round.external_course_id,
      v_round.tee_name,
      v_round.slope_rating,
      v_round.course_rating,
      v_round.match_opponent_handicap,
      v_round.om_match_result,
      v_round.match_score_text,
      v_round.notes,
      v_round.om_organization_id,
      v_round.om_competition_level,
      v_round.om_competition_format,
      v_round.om_rounds_18_count,
      v_round.score_entry_mode,
      v_round.om_match_play_wins,
      v_round.om_is_exceptional,
      v_round.om_exceptional_tournament_id,
      v_round.om_stats_submitted_at,
      v_round_date
    )
    returning id into v_round_id;

    for v_hole_payload in
      select value from jsonb_array_elements(p_holes)
    loop
      v_hole := jsonb_populate_record(null::public.golf_round_holes, v_hole_payload);
      insert into public.golf_round_holes (round_id, hole_no, par, stroke_index)
      values (v_round_id, v_hole.hole_no, v_hole.par, v_hole.stroke_index);
    end loop;

    v_round_ids := array_append(v_round_ids, v_round_id);
  end loop;

  return v_round_ids;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
end;
$$;

revoke all on function public.create_player_golf_rounds_transactional(uuid, jsonb, timestamptz[], jsonb) from public, anon;
grant execute on function public.create_player_golf_rounds_transactional(uuid, jsonb, timestamptz[], jsonb) to authenticated;
