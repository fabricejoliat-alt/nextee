-- OM ranking aggregation for manager/staff views.
-- Computes net/brut rankings with period caps (top 5/10/15 tournament rounds)
-- and bonus points in the current year up to a reference date.

create or replace function public.om_ranking_snapshot(
  p_org_id uuid,
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
  v_year_start date;
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
  v_year_start := make_date(extract(year from p_as_of)::int, 1, 1);

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
      s.calculated_at,
      g.start_at,
      coalesce(nullif(lower(trim(coalesce(g.competition_name, ''))), ''), concat('round:', s.round_id::text)) as tournament_key
    from public.om_tournament_scores s
    join public.golf_rounds g on g.id = s.round_id
    where s.organization_id = p_org_id
      and s.calculated_at::date >= v_year_start
      and s.calculated_at::date <= p_as_of
  ),
  dedup_scores as (
    select
      x.player_id,
      x.total_points_net,
      x.total_points_brut,
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
          order by ss.calculated_at desc, ss.round_id
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
        order by s.total_points_net desc, s.calculated_at desc, s.round_id
      ) as rn
    from dedup_scores s
  ),
  brut_ranked as (
    select
      s.player_id,
      s.total_points_brut as points,
      row_number() over (
        partition by s.player_id
        order by s.total_points_brut desc, s.calculated_at desc, s.round_id
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
      and be.occurred_on >= v_year_start
      and be.occurred_on <= p_as_of
    group by be.player_id
  ),
  players as (
    select tn.player_id as player_id from tour_net tn
    union
    select tb.player_id as player_id from tour_brut tb
    union
    select bo.player_id as player_id from bonus bo
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

grant execute on function public.om_ranking_snapshot(uuid, date) to authenticated;
