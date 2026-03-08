-- Add scope for player threads to support:
-- - direct: 1 thread per staff member <-> player
-- - team: 1 staff-only thread per organization+player

alter table if exists public.message_threads
  add column if not exists player_thread_scope text not null default 'direct';

alter table if exists public.message_threads
  drop constraint if exists message_threads_player_thread_scope_check;

alter table public.message_threads
  add constraint message_threads_player_thread_scope_check
  check (player_thread_scope in ('direct', 'team'));

drop index if exists public.idx_message_threads_unique_player_per_staff;
drop index if exists public.idx_message_threads_unique_player_per_org;

with ranked_direct as (
  select
    t.id,
    row_number() over (
      partition by t.organization_id, t.player_id, t.created_by
      order by t.updated_at desc, t.created_at desc, t.id desc
    ) as rn
  from public.message_threads t
  where t.thread_type = 'player'
    and t.player_id is not null
    and t.created_by is not null
    and coalesce(t.player_thread_scope, 'direct') = 'direct'
)
delete from public.message_threads t
using ranked_direct r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists idx_message_threads_unique_player_direct_per_staff
  on public.message_threads (organization_id, player_id, created_by)
  where thread_type = 'player'
    and player_id is not null
    and created_by is not null
    and player_thread_scope = 'direct';

with ranked_team as (
  select
    t.id,
    row_number() over (
      partition by t.organization_id, t.player_id
      order by t.updated_at desc, t.created_at desc, t.id desc
    ) as rn
  from public.message_threads t
  where t.thread_type = 'player'
    and t.player_id is not null
    and t.player_thread_scope = 'team'
)
delete from public.message_threads t
using ranked_team r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists idx_message_threads_unique_player_team_per_org
  on public.message_threads (organization_id, player_id)
  where thread_type = 'player'
    and player_id is not null
    and player_thread_scope = 'team';

