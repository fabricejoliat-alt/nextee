create table if not exists public.access_invitation_tokens (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invitation_kind text not null,
  sent_to_email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  sent_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table if exists public.access_invitation_tokens
  drop constraint if exists access_invitation_tokens_kind_check;

alter table if exists public.access_invitation_tokens
  add constraint access_invitation_tokens_kind_check
  check (invitation_kind in ('parent_access'));

create index if not exists idx_access_invitation_tokens_user_kind
  on public.access_invitation_tokens (user_id, invitation_kind, expires_at desc);

create index if not exists idx_access_invitation_tokens_active
  on public.access_invitation_tokens (token_hash, expires_at)
  where consumed_at is null;
