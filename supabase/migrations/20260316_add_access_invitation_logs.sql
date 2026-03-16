create table if not exists public.access_invitation_logs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  invitation_kind text not null,
  sent_to_email text not null,
  sent_by uuid not null references public.profiles(id) on delete cascade,
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.access_invitation_logs
  drop constraint if exists access_invitation_logs_kind_check;

alter table if exists public.access_invitation_logs
  add constraint access_invitation_logs_kind_check
  check (invitation_kind in ('parent_access', 'junior_access'));

create unique index if not exists idx_access_invitation_logs_unique
  on public.access_invitation_logs (club_id, recipient_user_id, target_user_id, invitation_kind);

create index if not exists idx_access_invitation_logs_club_kind
  on public.access_invitation_logs (club_id, invitation_kind, last_sent_at desc);
