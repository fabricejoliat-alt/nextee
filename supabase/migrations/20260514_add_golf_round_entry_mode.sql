-- Add competition score entry mode for golf rounds.
-- full: score + putts + fairway (existing behavior)
-- hole_only: only par + score; no GIR/scrambling/putts/fairway stats

alter table if exists public.golf_rounds
  add column if not exists score_entry_mode text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'golf_rounds_score_entry_mode_check'
  ) then
    alter table public.golf_rounds
      add constraint golf_rounds_score_entry_mode_check
      check (score_entry_mode in ('full', 'hole_only'));
  end if;
end $$;
