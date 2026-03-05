-- OM compute engine (round-level tournament points) + trigger.
-- Non-breaking: computes only when required competition fields are present.

create or replace function public.om_competition_coefficient(p_level text)
returns numeric
language sql
immutable
as $$
  select case p_level
    when 'club_internal' then 0.8
    when 'club_official' then 1.0
    when 'regional' then 1.2
    when 'national' then 1.4
    when 'international' then 1.6
    else 1.0
  end::numeric;
$$;

create or replace function public.om_holes_bonus_net(p_rounds_18_count smallint)
returns numeric
language sql
immutable
as $$
  select case p_rounds_18_count
    when 2 then 5
    when 3 then 10
    when 4 then 15
    else 0
  end::numeric;
$$;

create or replace function public.om_holes_bonus_brut(p_rounds_18_count smallint)
returns numeric
language sql
immutable
as $$
  select case p_rounds_18_count
    when 2 then 10
    when 3 then 20
    when 4 then 30
    else 0
  end::numeric;
$$;

create or replace function public.om_recompute_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.golf_rounds%rowtype;
  v_cr numeric(6,1);
  v_sr integer;
  v_gross numeric(8,2);
  v_net numeric(8,2);
  v_coef numeric;
  v_base_brut numeric;
  v_base_net numeric;
  v_bonus_holes_net numeric;
  v_bonus_holes_brut numeric;
  v_bonus_mp_net numeric;
  v_bonus_mp_brut numeric;
  v_bonus_exc_net numeric;
  v_bonus_exc_brut numeric;
  v_total_net numeric;
  v_total_brut numeric;
  v_org uuid;
begin
  select *
  into v_round
  from public.golf_rounds
  where id = p_round_id;

  if v_round.id is null then
    return jsonb_build_object('ok', false, 'reason', 'round_not_found');
  end if;

  -- Only competition rounds participate in tournament OM calculation.
  if v_round.round_type is distinct from 'competition' then
    delete from public.om_tournament_scores where round_id = v_round.id;
    return jsonb_build_object('ok', true, 'reason', 'not_competition');
  end if;

  -- Ensure required fields exist before computing.
  if v_round.om_organization_id is null
     or v_round.om_competition_level is null
     or v_round.om_competition_format is null
     or v_round.om_rounds_18_count is null
     or v_round.total_score is null
     or v_round.course_rating is null
     or v_round.slope_rating is null then
    delete from public.om_tournament_scores where round_id = v_round.id;
    return jsonb_build_object('ok', true, 'reason', 'missing_fields');
  end if;

  v_org := v_round.om_organization_id;
  v_cr := round(v_round.course_rating::numeric, 1);
  v_sr := v_round.slope_rating;
  v_gross := v_round.total_score::numeric;
  v_net := (v_round.total_score - coalesce(v_round.handicap_start, 0))::numeric;
  v_coef := public.om_competition_coefficient(v_round.om_competition_level);

  -- Base formulas.
  v_base_net := 100 + ((v_cr - v_net) * 5);
  v_base_brut := 150 + v_sr + ((v_cr - v_gross) * 5);

  -- Level coefficient is applied to base points.
  v_base_net := round(v_base_net * v_coef, 2);
  v_base_brut := round(v_base_brut * v_coef, 2);

  -- Bonuses.
  v_bonus_holes_net := public.om_holes_bonus_net(v_round.om_rounds_18_count);
  v_bonus_holes_brut := public.om_holes_bonus_brut(v_round.om_rounds_18_count);

  if v_round.om_competition_format = 'match_play_individual' then
    v_bonus_mp_net := coalesce(v_round.om_match_play_wins, 0) * 10;
    v_bonus_mp_brut := coalesce(v_round.om_match_play_wins, 0) * 10;
  else
    v_bonus_mp_net := 0;
    v_bonus_mp_brut := 0;
  end if;

  if coalesce(v_round.om_is_exceptional, false) then
    v_bonus_exc_net := 100;
    v_bonus_exc_brut := 150;
  else
    v_bonus_exc_net := 0;
    v_bonus_exc_brut := 0;
  end if;

  v_total_net := round(v_base_net + v_bonus_holes_net + v_bonus_mp_net + v_bonus_exc_net, 2);
  v_total_brut := round(v_base_brut + v_bonus_holes_brut + v_bonus_mp_brut + v_bonus_exc_brut, 2);

  insert into public.om_tournament_scores (
    round_id,
    organization_id,
    player_id,
    competition_level,
    competition_format,
    rounds_18_count,
    coefficient,
    score_gross,
    score_net,
    course_rating,
    slope_rating,
    base_points_brut,
    base_points_net,
    bonus_holes_points_brut,
    bonus_holes_points_net,
    bonus_match_play_points_brut,
    bonus_match_play_points_net,
    bonus_exceptional_points_brut,
    bonus_exceptional_points_net,
    total_points_brut,
    total_points_net,
    calculated_at
  )
  values (
    v_round.id,
    v_org,
    v_round.user_id,
    v_round.om_competition_level,
    v_round.om_competition_format,
    v_round.om_rounds_18_count,
    v_coef,
    round(v_gross, 2),
    round(v_net, 2),
    v_cr,
    v_sr,
    v_base_brut,
    v_base_net,
    v_bonus_holes_brut,
    v_bonus_holes_net,
    v_bonus_mp_brut,
    v_bonus_mp_net,
    v_bonus_exc_brut,
    v_bonus_exc_net,
    v_total_brut,
    v_total_net,
    now()
  )
  on conflict (round_id) do update set
    organization_id = excluded.organization_id,
    player_id = excluded.player_id,
    competition_level = excluded.competition_level,
    competition_format = excluded.competition_format,
    rounds_18_count = excluded.rounds_18_count,
    coefficient = excluded.coefficient,
    score_gross = excluded.score_gross,
    score_net = excluded.score_net,
    course_rating = excluded.course_rating,
    slope_rating = excluded.slope_rating,
    base_points_brut = excluded.base_points_brut,
    base_points_net = excluded.base_points_net,
    bonus_holes_points_brut = excluded.bonus_holes_points_brut,
    bonus_holes_points_net = excluded.bonus_holes_points_net,
    bonus_match_play_points_brut = excluded.bonus_match_play_points_brut,
    bonus_match_play_points_net = excluded.bonus_match_play_points_net,
    bonus_exceptional_points_brut = excluded.bonus_exceptional_points_brut,
    bonus_exceptional_points_net = excluded.bonus_exceptional_points_net,
    total_points_brut = excluded.total_points_brut,
    total_points_net = excluded.total_points_net,
    calculated_at = now();

  update public.golf_rounds
  set om_points_net = v_total_net,
      om_points_brut = v_total_brut,
      om_stats_submitted_at = coalesce(om_stats_submitted_at, now())
  where id = v_round.id;

  return jsonb_build_object(
    'ok', true,
    'round_id', v_round.id,
    'organization_id', v_org,
    'player_id', v_round.user_id,
    'total_points_net', v_total_net,
    'total_points_brut', v_total_brut
  );
end;
$$;

grant execute on function public.om_recompute_round(uuid) to authenticated;

create or replace function public.om_on_golf_round_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.om_recompute_round(new.id);
  return new;
end;
$$;

drop trigger if exists trg_om_recompute_round_on_golf_rounds on public.golf_rounds;
create trigger trg_om_recompute_round_on_golf_rounds
after insert or update of
  round_type,
  total_score,
  handicap_start,
  course_rating,
  slope_rating,
  om_organization_id,
  om_competition_level,
  om_competition_format,
  om_rounds_18_count,
  om_match_play_wins,
  om_is_exceptional,
  om_exceptional_tournament_id
on public.golf_rounds
for each row
execute function public.om_on_golf_round_change();

