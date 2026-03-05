-- OM: mark future rounds as not played when player misses the cut.

alter table if exists public.golf_rounds
  add column if not exists om_miss_cut boolean not null default false;

create index if not exists idx_golf_rounds_om_miss_cut
  on public.golf_rounds (om_miss_cut)
  where om_miss_cut = true;
