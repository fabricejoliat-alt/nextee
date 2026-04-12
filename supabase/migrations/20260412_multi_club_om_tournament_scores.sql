-- Allow a single competition round to count in multiple clubs' Order of Merit.
-- This fixes players with multiple active club memberships only receiving OM
-- tournament points in a single club.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.om_tournament_scores'::regclass
      and conname = 'om_tournament_scores_pkey'
      and pg_get_constraintdef(oid) <> 'PRIMARY KEY (round_id, organization_id)'
  ) then
    alter table public.om_tournament_scores
      drop constraint om_tournament_scores_pkey;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.om_tournament_scores'::regclass
      and conname = 'om_tournament_scores_pkey'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (round_id, organization_id)'
  ) then
    alter table public.om_tournament_scores
      add constraint om_tournament_scores_pkey primary key (round_id, organization_id);
  end if;
end $$;

create index if not exists idx_om_tournament_scores_round_id
  on public.om_tournament_scores (round_id);

alter table if exists public.om_tournament_scores
  add column if not exists occurred_on date;

update public.om_tournament_scores s
set occurred_on = (g.start_at at time zone 'Europe/Zurich')::date
from public.golf_rounds g
where g.id = s.round_id
  and (
    s.occurred_on is null
    or s.occurred_on <> (g.start_at at time zone 'Europe/Zurich')::date
  );

alter table public.om_tournament_scores
  alter column occurred_on set not null;

create index if not exists idx_om_tournament_scores_org_player_occurred_on
  on public.om_tournament_scores (organization_id, player_id, occurred_on desc);

create or replace function public.om_ranking_snapshot(
  p_org_id uuid,
  p_from date default null,
  p_as_of date default ((now() at time zone 'Europe/Zurich')::date)
)
returns table(
  player_id uuid,
  full_name text,
  tournament_points_net numeric(12,2),
  bonus_points_net numeric(12,2),
  total_points_net numeric(12,2),
  rank_net integer,
  tournament_points_brut numeric(12,2),
  bonus_points_brut numeric(12,2),
  total_points_brut numeric(12,2),
  rank_brut integer,
  period_slot smallint,
  period_limit integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slot smallint;
  v_limit integer;
  v_from date;
begin
  if p_org_id is null then
    raise exception 'organization_required';
  end if;

  if p_as_of is null then
    p_as_of := (now() at time zone 'Europe/Zurich')::date;
  end if;

  if not (
    public.is_org_staff_member(p_org_id, auth.uid())
    or exists (
      select 1
      from public.club_members cm
      where cm.club_id = p_org_id
        and cm.user_id = auth.uid()
        and cm.is_active = true
        and cm.role in ('player', 'parent', 'coach', 'manager')
    )
    or exists (
      select 1
      from public.player_guardians pg
      join public.club_members cm_player
        on cm_player.user_id = pg.player_id
       and cm_player.club_id = p_org_id
       and cm_player.role = 'player'
       and cm_player.is_active = true
      where pg.guardian_user_id = auth.uid()
        and coalesce(pg.can_view, true) = true
    )
  ) then
    raise exception 'forbidden';
  end if;

  v_slot := public.om_period_slot(p_as_of);
  v_limit := public.om_period_limit(v_slot);
  v_from := coalesce(p_from, make_date(extract(year from p_as_of)::int, 1, 1));
  if v_from > p_as_of then
    v_from := p_as_of;
  end if;

  return query
  with
  source_scores as (
    select
      s.round_id,
      s.player_id,
      s.competition_level,
      s.competition_format,
      s.rounds_18_count,
      s.total_points_net,
      s.total_points_brut,
      s.occurred_on,
      s.calculated_at,
      g.start_at,
      coalesce(nullif(lower(trim(coalesce(g.competition_name, ''))), ''), concat('round:', s.round_id::text)) as tournament_key
    from public.om_tournament_scores s
    join public.golf_rounds g on g.id = s.round_id
    where s.organization_id = p_org_id
      and s.occurred_on >= v_from
      and s.occurred_on <= p_as_of
  ),
  dedup_scores as (
    select
      x.player_id,
      x.total_points_net,
      x.total_points_brut,
      x.occurred_on,
      x.calculated_at,
      x.round_id
    from (
      select
        ss.*,
        row_number() over (
          partition by
            ss.player_id,
            case
              when coalesce(ss.rounds_18_count, 1) > 1 then concat_ws(
                '|',
                ss.player_id::text,
                ss.competition_level,
                ss.competition_format,
                coalesce(ss.rounds_18_count, 1)::text,
                extract(year from ss.start_at)::int::text,
                ss.tournament_key
              )
              else ss.round_id::text
            end
          order by ss.occurred_on desc, ss.calculated_at desc, ss.round_id
        ) as rn_group
      from source_scores ss
    ) x
    where x.rn_group = 1
  ),
  net_ranked as (
    select
      s.player_id,
      s.total_points_net as points,
      row_number() over (
        partition by s.player_id
        order by s.total_points_net desc, s.occurred_on desc, s.calculated_at desc, s.round_id
      ) as rn
    from dedup_scores s
  ),
  brut_ranked as (
    select
      s.player_id,
      s.total_points_brut as points,
      row_number() over (
        partition by s.player_id
        order by s.total_points_brut desc, s.occurred_on desc, s.calculated_at desc, s.round_id
      ) as rn
    from dedup_scores s
  ),
  tour_net as (
    select
      n.player_id,
      coalesce(sum(n.points), 0)::numeric(12,2) as tournament_points_net
    from net_ranked n
    where n.rn <= v_limit
    group by n.player_id
  ),
  tour_brut as (
    select
      b.player_id,
      coalesce(sum(b.points), 0)::numeric(12,2) as tournament_points_brut
    from brut_ranked b
    where b.rn <= v_limit
    group by b.player_id
  ),
  bonus as (
    select
      be.player_id,
      coalesce(sum(be.points_net), 0)::numeric(12,2) as bonus_points_net,
      coalesce(sum(be.points_brut), 0)::numeric(12,2) as bonus_points_brut
    from public.om_bonus_entries be
    where be.organization_id = p_org_id
      and be.occurred_on >= v_from
      and be.occurred_on <= p_as_of
    group by be.player_id
  ),
  eligible_players as (
    select distinct cm.user_id as player_id
    from public.club_members cm
    where cm.club_id = p_org_id
      and cm.role = 'player'
      and cm.is_active = true
      and coalesce(cm.is_performance, false) = true
  ),
  players_raw as (
    select tn.player_id as player_id from tour_net tn
    union
    select tb.player_id as player_id from tour_brut tb
    union
    select bo.player_id as player_id from bonus bo
  ),
  players as (
    select pr.player_id
    from players_raw pr
    join eligible_players ep on ep.player_id = pr.player_id
  ),
  totals as (
    select
      p.player_id,
      trim(concat(coalesce(pr.first_name, ''), ' ', coalesce(pr.last_name, ''))) as full_name,
      coalesce(tn.tournament_points_net, 0)::numeric(12,2) as tournament_points_net,
      coalesce(b.bonus_points_net, 0)::numeric(12,2) as bonus_points_net,
      (coalesce(tn.tournament_points_net, 0) + coalesce(b.bonus_points_net, 0))::numeric(12,2) as total_points_net,
      coalesce(tb.tournament_points_brut, 0)::numeric(12,2) as tournament_points_brut,
      coalesce(b.bonus_points_brut, 0)::numeric(12,2) as bonus_points_brut,
      (coalesce(tb.tournament_points_brut, 0) + coalesce(b.bonus_points_brut, 0))::numeric(12,2) as total_points_brut
    from players p
    left join public.profiles pr on pr.id = p.player_id
    left join tour_net tn on tn.player_id = p.player_id
    left join tour_brut tb on tb.player_id = p.player_id
    left join bonus b on b.player_id = p.player_id
  )
  select
    t.player_id,
    case when t.full_name = '' then '—' else t.full_name end as full_name,
    t.tournament_points_net,
    t.bonus_points_net,
    t.total_points_net,
    (dense_rank() over (order by t.total_points_net desc, t.full_name asc, t.player_id))::int as rank_net,
    t.tournament_points_brut,
    t.bonus_points_brut,
    t.total_points_brut,
    (dense_rank() over (order by t.total_points_brut desc, t.full_name asc, t.player_id))::int as rank_brut,
    v_slot as period_slot,
    v_limit as period_limit
  from totals t
  order by t.total_points_net desc, t.full_name asc, t.player_id;
end;
$$;

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

    -- Prefer stored total_score, fallback to hole-by-hole sum.
    select
      sum(h.score::numeric)
    into v_round_total_score
    from public.golf_round_holes h
    where h.round_id = v_round.id;

    if v_round.total_score is not null then
      v_round_total_score := v_round.total_score::numeric;
    end if;

    if v_round_total_score is null then
      delete from public.om_tournament_scores where round_id = v_round.id;
      return jsonb_build_object('ok', true, 'reason', 'missing_stroke_score');
    end if;

    v_cr := round(v_round.course_rating::numeric, 1);
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
          coalesce(gr.total_score::numeric, sum(h.score::numeric)) - coalesce(gr.handicap_start, 0)::numeric as score_net
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
        group by gr.id, gr.total_score, gr.handicap_start
        having coalesce(gr.total_score::numeric, sum(h.score::numeric)) is not null
      ) g;
    else
      v_gross := v_round_total_score;
      v_net := v_round_total_score - coalesce(v_round.handicap_start, 0)::numeric;
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
  loop
    perform public.om_recompute_round(r.id);
  end loop;
end $$;
