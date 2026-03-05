-- Publish internal contest rankings and sync OM bonus entries for podium.

create or replace function public.om_publish_internal_contest(
  p_contest_id uuid,
  p_rankings jsonb,
  p_full_ranking jsonb default '[]'::jsonb
)
returns table(saved_rows integer, bonus_rows integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_contest_date date;
  v_saved integer := 0;
  v_bonus integer := 0;
begin
  if p_contest_id is null then
    raise exception 'contest_required';
  end if;

  select c.organization_id, c.contest_date
  into v_org_id, v_contest_date
  from public.om_internal_contests c
  where c.id = p_contest_id;

  if v_org_id is null then
    raise exception 'contest_not_found';
  end if;

  if not public.is_org_manager_member(v_org_id, auth.uid()) then
    raise exception 'forbidden';
  end if;

  if p_rankings is null or jsonb_typeof(p_rankings) <> 'array' then
    raise exception 'rankings_must_be_array';
  end if;

  update public.om_internal_contests
  set
    full_ranking = coalesce(p_full_ranking, '[]'::jsonb),
    updated_at = now()
  where id = p_contest_id;

  delete from public.om_internal_contest_results r
  where r.contest_id = p_contest_id;

  insert into public.om_internal_contest_results (
    contest_id,
    player_id,
    rank,
    points_net,
    points_brut,
    note
  )
  select
    p_contest_id,
    (x.item->>'player_id')::uuid as player_id,
    greatest((x.item->>'rank')::int, 1) as rank,
    case
      when greatest((x.item->>'rank')::int, 1) = 1 then 15
      when greatest((x.item->>'rank')::int, 1) = 2 then 10
      when greatest((x.item->>'rank')::int, 1) = 3 then 5
      else 0
    end::numeric(10,2) as points_net,
    case
      when greatest((x.item->>'rank')::int, 1) = 1 then 15
      when greatest((x.item->>'rank')::int, 1) = 2 then 10
      when greatest((x.item->>'rank')::int, 1) = 3 then 5
      else 0
    end::numeric(10,2) as points_brut,
    nullif(x.item->>'note', '') as note
  from jsonb_array_elements(p_rankings) as x(item)
  where (x.item->>'player_id') is not null
    and (x.item->>'rank') is not null;

  get diagnostics v_saved = row_count;

  delete from public.om_bonus_entries b
  where b.source_table = 'om_internal_contests'
    and b.source_id = p_contest_id
    and b.bonus_type = 'internal_contest_podium';

  insert into public.om_bonus_entries (
    organization_id,
    player_id,
    bonus_type,
    points_net,
    points_brut,
    source_table,
    source_id,
    description,
    occurred_on,
    created_by
  )
  select
    v_org_id,
    r.player_id,
    'internal_contest_podium',
    r.points_net,
    r.points_brut,
    'om_internal_contests',
    p_contest_id,
    'Internal contest podium',
    v_contest_date,
    auth.uid()
  from public.om_internal_contest_results r
  where r.contest_id = p_contest_id
    and r.rank <= 3
    and (r.points_net > 0 or r.points_brut > 0);

  get diagnostics v_bonus = row_count;

  return query select v_saved, v_bonus;
end;
$$;

grant execute on function public.om_publish_internal_contest(uuid, jsonb, jsonb) to authenticated;

