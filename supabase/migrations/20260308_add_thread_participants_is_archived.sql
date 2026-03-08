-- Allow each participant to archive a thread for themselves.

alter table if exists public.thread_participants
  add column if not exists is_archived boolean not null default false;

create index if not exists idx_thread_participants_user_archived
  on public.thread_participants (user_id, is_archived, updated_at desc);

