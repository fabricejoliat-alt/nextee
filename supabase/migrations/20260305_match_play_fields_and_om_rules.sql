-- Match-play specific fields + OM rule: lost match = 0 points.

alter table if exists public.golf_rounds
  add column if not exists match_opponent_handicap numeric(5,2),
  add column if not exists om_match_result text,
  add column if not exists match_score_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'golf_rounds_om_match_result_check'
  ) then
    alter table public.golf_rounds
      add constraint golf_rounds_om_match_result_check
      check (om_match_result is null or om_match_result in ('won', 'lost'));
  end if;
end $$;

create or replace function public.om_recompute_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.golf_rounds%rowtype;
  v_comp_level text;
  v_rounds_18_count smallint;
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
  select * into v_round
  from public.golf_rounds
  where id = p_round_id;

  if v_round.id is null then
    return jsonb_build_object('ok', false, 'reason', 'round_not_found');
  end if;

  if v_round.round_type is distinct from 'competition' then
    delete from public.om_tournament_scores where round_id = v_round.id;
    return jsonb_build_object('ok', true, 'reason', 'not_competition');
  end if;

  if v_round.om_organization_id is null
     or v_round.om_competition_format is null then
    delete from public.om_tournament_scores where round_id = v_round.id;
    return jsonb_build_object('ok', true, 'reason', 'missing_core_fields');
  end if;

  if v_round.om_competition_format = 'match_play_individual' then
    v_comp_level := coalesce(v_round.om_competition_level, 'club_official');
    v_rounds_18_count := coalesce(v_round.om_rounds_18_count, 1);
  else
    if v_round.om_competition_level is null or v_round.om_rounds_18_count is null then
      delete from public.om_tournament_scores where round_id = v_round.id;
      return jsonb_build_object('ok', true, 'reason', 'missing_stroke_core_fields');
    end if;
    v_comp_level := v_round.om_competition_level;
    v_rounds_18_count := v_round.om_rounds_18_count;
  end if;

  v_org := v_round.om_organization_id;
  v_coef := case
    when v_round.om_competition_format = 'match_play_individual' then 1
    else public.om_competition_coefficient(v_comp_level)
  end;

  -- Match-play path: no scorecard/CR/SR required.
  if v_round.om_competition_format = 'match_play_individual' then
    v_cr := 0;
    v_sr := 0;
    v_gross := 0;
    v_net := 0;
    v_base_net := 0;
    v_base_brut := 0;
    v_bonus_holes_net := 0;
    v_bonus_holes_brut := 0;
    v_bonus_exc_net := 0;
    v_bonus_exc_brut := 0;

    if coalesce(v_round.om_match_result, 'lost') = 'won' then
      v_bonus_mp_net := 10;
      v_bonus_mp_brut := 10;
      v_total_net := 10;
      v_total_brut := 10;
    else
      -- Explicit business rule: lost match gives 0 OM points.
      v_bonus_mp_net := 0;
      v_bonus_mp_brut := 0;
      v_total_net := 0;
      v_total_brut := 0;
    end if;
  else
    -- Stroke-play path (existing behavior with tournament average for multi-round).
    if v_round.total_score is null or v_round.course_rating is null or v_round.slope_rating is null then
      delete from public.om_tournament_scores where round_id = v_round.id;
      return jsonb_build_object('ok', true, 'reason', 'missing_stroke_fields');
    end if;

    v_cr := round(v_round.course_rating::numeric, 1);
    v_sr := v_round.slope_rating;

    if coalesce(v_rounds_18_count, 1) > 1
       and nullif(trim(coalesce(v_round.competition_name, '')), '') is not null then
      select
        round(avg(gr.total_score::numeric), 2),
        round(avg((gr.total_score - coalesce(gr.handicap_start, 0))::numeric), 2)
      into v_gross, v_net
      from public.golf_rounds gr
      where gr.round_type = 'competition'
        and gr.user_id = v_round.user_id
        and gr.om_organization_id = v_round.om_organization_id
        and gr.om_competition_level = v_comp_level
        and gr.om_competition_format = v_round.om_competition_format
        and gr.om_rounds_18_count = v_rounds_18_count
        and date_trunc('year', gr.start_at) = date_trunc('year', v_round.start_at)
        and lower(trim(coalesce(gr.competition_name, ''))) = lower(trim(coalesce(v_round.competition_name, '')))
        and gr.total_score is not null;
    else
      v_gross := v_round.total_score::numeric;
      v_net := (v_round.total_score - coalesce(v_round.handicap_start, 0))::numeric;
    end if;

    if v_gross is null or v_net is null then
      delete from public.om_tournament_scores where round_id = v_round.id;
      return jsonb_build_object('ok', true, 'reason', 'missing_scores_for_average');
    end if;

    v_base_net := 100 + ((v_cr - v_net) * 5);
    v_base_brut := 150 + v_sr + ((v_cr - v_gross) * 5);
    v_base_net := round(v_base_net * v_coef, 2);
    v_base_brut := round(v_base_brut * v_coef, 2);

    v_bonus_holes_net := public.om_holes_bonus_net(v_rounds_18_count);
    v_bonus_holes_brut := public.om_holes_bonus_brut(v_rounds_18_count);
    v_bonus_mp_net := 0;
    v_bonus_mp_brut := 0;
    if coalesce(v_round.om_is_exceptional, false) then
      v_bonus_exc_net := 100;
      v_bonus_exc_brut := 150;
    else
      v_bonus_exc_net := 0;
      v_bonus_exc_brut := 0;
    end if;

    v_total_net := round(v_base_net + v_bonus_holes_net + v_bonus_mp_net + v_bonus_exc_net, 2);
    v_total_brut := round(v_base_brut + v_bonus_holes_brut + v_bonus_mp_brut + v_bonus_exc_brut, 2);
  end if;

  insert into public.om_tournament_scores (
    round_id, organization_id, player_id, competition_level, competition_format, rounds_18_count, coefficient,
    score_gross, score_net, course_rating, slope_rating,
    base_points_brut, base_points_net,
    bonus_holes_points_brut, bonus_holes_points_net,
    bonus_match_play_points_brut, bonus_match_play_points_net,
    bonus_exceptional_points_brut, bonus_exceptional_points_net,
    total_points_brut, total_points_net, calculated_at
  )
  values (
    v_round.id, v_org, v_round.user_id, v_comp_level, v_round.om_competition_format, v_rounds_18_count, v_coef,
    round(v_gross, 2), round(v_net, 2), v_cr, v_sr,
    v_base_brut, v_base_net,
    v_bonus_holes_brut, v_bonus_holes_net,
    v_bonus_mp_brut, v_bonus_mp_net,
    v_bonus_exc_brut, v_bonus_exc_net,
    v_total_brut, v_total_net, now()
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
    'score_gross_used', v_gross,
    'score_net_used', v_net,
    'total_points_net', v_total_net,
    'total_points_brut', v_total_brut
  );
end;
$$;
