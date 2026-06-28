create table if not exists public.player_handicap_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  effective_date date not null,
  value numeric(5,1) not null,
  note text,
  source text not null default 'manual' check (source in ('manual')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_handicap_history_value_range check (value >= -10 and value <= 99.9),
  constraint player_handicap_history_unique_date unique (user_id, effective_date)
);

create index if not exists player_handicap_history_user_effective_date_idx
  on public.player_handicap_history (user_id, effective_date desc);

alter table if exists public.player_handicap_history enable row level security;

create or replace function public.touch_player_handicap_history_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_player_handicap_history_updated_at on public.player_handicap_history;
create trigger trg_player_handicap_history_updated_at
before update on public.player_handicap_history
for each row
execute function public.touch_player_handicap_history_updated_at();

drop policy if exists "player_handicap_history_select_own" on public.player_handicap_history;
create policy "player_handicap_history_select_own"
on public.player_handicap_history
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "player_handicap_history_insert_own" on public.player_handicap_history;
create policy "player_handicap_history_insert_own"
on public.player_handicap_history
for insert
to authenticated
with check (user_id = auth.uid() and (created_by is null or created_by = auth.uid()));

drop policy if exists "player_handicap_history_update_own" on public.player_handicap_history;
create policy "player_handicap_history_update_own"
on public.player_handicap_history
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "player_handicap_history_delete_own" on public.player_handicap_history;
create policy "player_handicap_history_delete_own"
on public.player_handicap_history
for delete
to authenticated
using (user_id = auth.uid());
