-- Fix OM net score for true single 9-hole competitions.
-- Current logic subtracts the full 18-hole handicap from a 9-hole gross score,
-- which makes the OM net score artificially low. For a real 1 x 9 competition,
-- we prorate the handicap by half before computing OM net/base points.

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
  v_round_total_score numeric(8,2);
  v_target_org_ids uuid[];
  v_target_org_id uuid;
  v_round_holes_count integer;
  v_is_double_nine_layout boolean := false;
  v_points_factor numeric(4,2) := 1;
  v_handicap_for_net numeric(8,2);
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

  v_coef := case
    when v_round.om_competition_format = 'match_play_individual' then 1
    else public.om_competition_coefficient(v_comp_level)
  end;

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
      v_bonus_mp_net := 0;
      v_bonus_mp_brut := 0;
      v_total_net := 0;
      v_total_brut := 0;
    end if;
  else
    if v_round.course_rating is null or v_round.slope_rating is null then
      delete from public.om_tournament_scores where round_id = v_round.id;
      return jsonb_build_object('ok', true, 'reason', 'missing_stroke_fields');
    end if;

    select
      count(*),
      sum(h.score::numeric)
    into v_round_holes_count, v_round_total_score
    from public.golf_round_holes h
    where h.round_id = v_round.id;

    if v_round.total_score is not null then
      v_round_total_score := v_round.total_score::numeric;
    end if;

    if v_round_total_score is null then
      delete from public.om_tournament_scores where round_id = v_round.id;
      return jsonb_build_object('ok', true, 'reason', 'missing_stroke_score');
    end if;

    if coalesce(v_rounds_18_count, 1) = 1 and coalesce(v_round_holes_count, 0) = 9 then
      v_points_factor := 0.5;
    end if;

    if coalesce(v_rounds_18_count, 1) = 1
       and coalesce(v_round_holes_count, 0) = 18
       and coalesce(v_round.course_rating, 0) <= 40 then
      select coalesce(
        bool_and(
          h_front.par is not distinct from h_back.par
          and h_front.stroke_index is not distinct from h_back.stroke_index
        ),
        false
      )
      into v_is_double_nine_layout
      from public.golf_round_holes h_front
      join public.golf_round_holes h_back
        on h_back.round_id = h_front.round_id
       and h_back.hole_no = h_front.hole_no + 9
      where h_front.round_id = v_round.id
        and h_front.hole_no between 1 and 9;
    end if;

    v_cr := round(
      case
        when v_is_double_nine_layout then v_round.course_rating::numeric * 2
        else v_round.course_rating::numeric
      end,
      1
    );
    v_sr := v_round.slope_rating;

    if coalesce(v_rounds_18_count, 1) > 1
       and nullif(trim(coalesce(v_round.competition_name, '')), '') is not null then
      select
        round(avg(g.score_gross), 2),
        round(avg(g.score_net), 2)
      into v_gross, v_net
      from (
        select
          coalesce(gr.total_score::numeric, sum(h.score::numeric)) as score_gross,
          coalesce(gr.total_score::numeric, sum(h.score::numeric))
            - case
                when coalesce(gr.om_rounds_18_count, 1) = 1
                     and count(h.*) filter (where h.score is not null) = 9
                  then coalesce(gr.handicap_start, 0)::numeric / 2
                else coalesce(gr.handicap_start, 0)::numeric
              end as score_net
        from public.golf_rounds gr
        left join public.golf_round_holes h on h.round_id = gr.id and h.score is not null
        where gr.round_type = 'competition'
          and gr.user_id = v_round.user_id
          and gr.om_organization_id = v_round.om_organization_id
          and gr.om_competition_level = v_comp_level
          and gr.om_competition_format = v_round.om_competition_format
          and gr.om_rounds_18_count = v_rounds_18_count
          and date_trunc('year', gr.start_at) = date_trunc('year', v_round.start_at)
          and lower(trim(coalesce(gr.competition_name, ''))) = lower(trim(coalesce(v_round.competition_name, '')))
        group by gr.id, gr.total_score, gr.handicap_start, gr.om_rounds_18_count
        having coalesce(gr.total_score::numeric, sum(h.score::numeric)) is not null
      ) g;
    else
      v_gross := v_round_total_score;
      v_handicap_for_net :=
        case
          when coalesce(v_rounds_18_count, 1) = 1 and coalesce(v_round_holes_count, 0) = 9
            then coalesce(v_round.handicap_start, 0)::numeric / 2
          else coalesce(v_round.handicap_start, 0)::numeric
        end;
      v_net := v_round_total_score - v_handicap_for_net;
    end if;

    if v_gross is null or v_net is null then
      delete from public.om_tournament_scores where round_id = v_round.id;
      return jsonb_build_object('ok', true, 'reason', 'missing_scores_for_average');
    end if;

    v_base_net := 100 + ((v_cr - v_net) * 5);
    v_base_brut := 150 + v_sr + ((v_cr - v_gross) * 5);
    v_base_net := round(v_base_net * v_coef * v_points_factor, 2);
    v_base_brut := round(v_base_brut * v_coef * v_points_factor, 2);

    v_bonus_holes_net := round(public.om_holes_bonus_net(v_rounds_18_count) * v_points_factor, 2);
    v_bonus_holes_brut := round(public.om_holes_bonus_brut(v_rounds_18_count) * v_points_factor, 2);
    v_bonus_mp_net := 0;
    v_bonus_mp_brut := 0;
    if coalesce(v_round.om_is_exceptional, false) then
      v_bonus_exc_net := round(100 * v_points_factor, 2);
      v_bonus_exc_brut := round(150 * v_points_factor, 2);
    else
      v_bonus_exc_net := 0;
      v_bonus_exc_brut := 0;
    end if;

    v_total_net := round(v_base_net + v_bonus_holes_net + v_bonus_mp_net + v_bonus_exc_net, 2);
    v_total_brut := round(v_base_brut + v_bonus_holes_brut + v_bonus_mp_brut + v_bonus_exc_brut, 2);
  end if;

  select coalesce(array_agg(distinct cm.club_id order by cm.club_id), '{}'::uuid[])
  into v_target_org_ids
  from public.club_members cm
  where cm.user_id = v_round.user_id
    and cm.role = 'player'
    and cm.is_active = true;

  if not (v_round.om_organization_id = any(v_target_org_ids)) then
    v_target_org_ids := array_append(v_target_org_ids, v_round.om_organization_id);
  end if;

  delete from public.om_tournament_scores
  where round_id = v_round.id;

  foreach v_target_org_id in array v_target_org_ids
  loop
    insert into public.om_tournament_scores (
      round_id, organization_id, player_id, competition_level, competition_format, rounds_18_count, coefficient,
      score_gross, score_net, course_rating, slope_rating,
      base_points_brut, base_points_net,
      bonus_holes_points_brut, bonus_holes_points_net,
      bonus_match_play_points_brut, bonus_match_play_points_net,
      bonus_exceptional_points_brut, bonus_exceptional_points_net,
      total_points_brut, total_points_net, occurred_on, calculated_at
    )
    values (
      v_round.id, v_target_org_id, v_round.user_id, v_comp_level, v_round.om_competition_format, v_rounds_18_count, v_coef,
      round(v_gross, 2), round(v_net, 2), v_cr, v_sr,
      v_base_brut, v_base_net,
      v_bonus_holes_brut, v_bonus_holes_net,
      v_bonus_mp_brut, v_bonus_mp_net,
      v_bonus_exc_brut, v_bonus_exc_net,
      v_total_brut, v_total_net, (v_round.start_at at time zone 'Europe/Zurich')::date, now()
    );
  end loop;

  update public.golf_rounds
  set om_points_net = v_total_net,
      om_points_brut = v_total_brut,
      om_stats_submitted_at = coalesce(om_stats_submitted_at, now())
  where id = v_round.id;

  return jsonb_build_object(
    'ok', true,
    'round_id', v_round.id,
    'organization_ids', to_jsonb(v_target_org_ids),
    'organization_count', coalesce(array_length(v_target_org_ids, 1), 0),
    'player_id', v_round.user_id,
    'score_gross_used', v_gross,
    'score_net_used', v_net,
    'handicap_used_for_net',
      case
        when v_round.om_competition_format = 'match_play_individual' then 0
        when coalesce(v_rounds_18_count, 1) = 1 and coalesce(v_round_holes_count, 0) = 9
          then coalesce(v_round.handicap_start, 0)::numeric / 2
        else coalesce(v_round.handicap_start, 0)::numeric
      end,
    'course_rating_used', v_cr,
    'detected_double_nine_layout', v_is_double_nine_layout,
    'points_factor', v_points_factor,
    'total_points_net', v_total_net,
    'total_points_brut', v_total_brut
  );
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select gr.id
    from public.golf_rounds gr
    where gr.round_type = 'competition'
      and gr.om_competition_format = 'stroke_play_individual'
  loop
    perform public.om_recompute_round(r.id);
  end loop;
end $$;
