-- Give every golf competition a stable tournament identity.
-- Round names are not unique and must never be used to associate tournament days.

alter table public.golf_rounds
  add column if not exists tournament_group_id uuid;

create index if not exists golf_rounds_tournament_group_id_idx
  on public.golf_rounds (tournament_group_id, start_at, id)
  where tournament_group_id is not null;

-- Transactional multi-round creation gives all rows in a batch the exact same
-- created_at value. Use that fact to recover existing batches without merging
-- distinct tournaments that happen to share a name.
with batch_keys as (
  select
    gr.user_id,
    gr.created_at,
    gen_random_uuid() as tournament_group_id
  from public.golf_rounds gr
  where gr.round_type = 'competition'
    and gr.tournament_group_id is null
  group by gr.user_id, gr.created_at
)
update public.golf_rounds gr
set tournament_group_id = batch_keys.tournament_group_id
from batch_keys
where gr.user_id = batch_keys.user_id
  and gr.created_at = batch_keys.created_at
  and gr.round_type = 'competition'
  and gr.tournament_group_id is null;

-- Repair stale metadata left by editing one day of an existing tournament.
-- The batch size is the authoritative round count for historical rows.
with tournament_sizes as (
  select
    gr.tournament_group_id,
    count(*)::smallint as round_count
  from public.golf_rounds gr
  where gr.round_type = 'competition'
    and gr.om_competition_format = 'stroke_play_individual'
    and gr.tournament_group_id is not null
  group by gr.tournament_group_id
  having count(*) between 1 and 4
)
update public.golf_rounds gr
set om_rounds_18_count = tournament_sizes.round_count
from tournament_sizes
where gr.tournament_group_id = tournament_sizes.tournament_group_id
  and gr.om_rounds_18_count is distinct from tournament_sizes.round_count;

create or replace function public.guard_golf_tournament_group_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_round_count integer;
begin
  if old.tournament_group_id is not null
    and new.tournament_group_id is distinct from old.tournament_group_id
  then
    raise exception using errcode = 'P0001', message = 'TOURNAMENT_GROUP_IMMUTABLE';
  end if;

  if old.tournament_group_id is not null
    and new.round_type = 'competition'
    and new.om_competition_format = 'stroke_play_individual'
  then
    select count(*)::integer
    into v_round_count
    from public.golf_rounds gr
    where gr.tournament_group_id = old.tournament_group_id;

    if new.om_rounds_18_count is distinct from v_round_count then
      raise exception using errcode = 'P0001', message = 'INVALID_TOURNAMENT_ROUND_COUNT';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists golf_rounds_guard_tournament_group on public.golf_rounds;
create trigger golf_rounds_guard_tournament_group
before update of tournament_group_id, om_rounds_18_count
on public.golf_rounds
for each row
execute function public.guard_golf_tournament_group_consistency();

create or replace function public.sync_golf_tournament_size_after_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_round_count integer;
begin
  if old.tournament_group_id is null
    or old.round_type is distinct from 'competition'
    or old.om_competition_format is distinct from 'stroke_play_individual'
  then
    return old;
  end if;

  select count(*)::integer
  into v_round_count
  from public.golf_rounds gr
  where gr.tournament_group_id = old.tournament_group_id;

  if v_round_count between 1 and 4 then
    update public.golf_rounds gr
    set om_rounds_18_count = v_round_count
    where gr.tournament_group_id = old.tournament_group_id
      and gr.om_rounds_18_count is distinct from v_round_count;
  end if;

  return old;
end;
$$;

drop trigger if exists golf_rounds_sync_tournament_size_after_delete on public.golf_rounds;
create trigger golf_rounds_sync_tournament_size_after_delete
after delete on public.golf_rounds
for each row
execute function public.sync_golf_tournament_size_after_delete();

-- Preserve the already deployed, validated implementation behind a private
-- wrapper. The wrapper assigns one server-generated identity to every returned
-- round, including single-round competitions.
alter function public.create_player_golf_rounds_transactional(
  uuid, jsonb, timestamptz[], jsonb
) rename to create_player_golf_rounds_transactional_without_group_id;

revoke all on function public.create_player_golf_rounds_transactional_without_group_id(
  uuid, jsonb, timestamptz[], jsonb
) from public, anon, authenticated;

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
  v_round_ids uuid[];
  v_tournament_group_id uuid := gen_random_uuid();
  v_expected_count integer;
  v_updated_count integer;
begin
  v_round_ids := public.create_player_golf_rounds_transactional_without_group_id(
    p_player_id,
    p_round_payload,
    p_round_dates,
    p_holes
  );

  v_expected_count := coalesce(array_length(v_round_ids, 1), 0);
  if v_expected_count = 0 then
    raise exception using errcode = 'P0001', message = 'ROUND_CREATION_FAILED';
  end if;

  update public.golf_rounds gr
  set tournament_group_id = v_tournament_group_id
  where gr.id = any(v_round_ids)
    and gr.user_id = p_player_id
    and gr.round_type = 'competition';

  get diagnostics v_updated_count = row_count;

  if coalesce(p_round_payload ->> 'round_type', '') = 'competition'
    and v_updated_count <> v_expected_count
  then
    raise exception using errcode = 'P0001', message = 'ROUND_CREATION_FAILED';
  end if;

  return v_round_ids;
end;
$$;

revoke all on function public.create_player_golf_rounds_transactional(
  uuid, jsonb, timestamptz[], jsonb
) from public, anon;
grant execute on function public.create_player_golf_rounds_transactional(
  uuid, jsonb, timestamptz[], jsonb
) to authenticated;
