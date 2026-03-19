alter table if exists public.player_dashboard_documents
  add column if not exists club_event_id uuid null references public.club_events(id) on delete set null;

create index if not exists idx_player_dashboard_documents_event_created
  on public.player_dashboard_documents (club_event_id, created_at desc)
  where club_event_id is not null;
