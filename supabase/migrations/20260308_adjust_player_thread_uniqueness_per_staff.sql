-- Allow one player thread per staff member (coach/manager/captain) and player.
-- Replaces org+player uniqueness with org+player+created_by uniqueness.

drop index if exists public.idx_message_threads_unique_player_per_org;

with ranked as (
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
)
delete from public.message_threads t
using ranked r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists idx_message_threads_unique_player_per_staff
  on public.message_threads (organization_id, player_id, created_by)
  where thread_type = 'player'
    and player_id is not null
    and created_by is not null;

