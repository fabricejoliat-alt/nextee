-- Additive evolution of family access e-mail templates and player consent metadata.
-- Existing parent/junior templates and membership consent values remain intact.

alter table if exists public.club_access_invitation_mail_configs
  add column if not exists junior_direct_subject text,
  add column if not exists junior_direct_body text,
  add column if not exists junior_parent_subject text,
  add column if not exists junior_parent_body text,
  add column if not exists consent_subject text,
  add column if not exists consent_body text;

update public.club_access_invitation_mail_configs
set
  junior_parent_subject = coalesce(junior_parent_subject, junior_subject),
  junior_parent_body = coalesce(junior_parent_body, junior_body),
  junior_direct_subject = coalesce(junior_direct_subject, junior_subject),
  junior_direct_body = coalesce(junior_direct_body, junior_body)
where junior_parent_subject is null
   or junior_parent_body is null
   or junior_direct_subject is null
   or junior_direct_body is null;

alter table if exists public.club_members
  drop constraint if exists club_members_player_consent_status_check;

alter table if exists public.club_members
  add constraint club_members_player_consent_status_check
  check (
    player_consent_status is null
    or player_consent_status in ('granted', 'pending', 'refused', 'adult')
  );

create table if not exists public.player_consents (
  club_id uuid not null references public.clubs(id) on delete cascade,
  player_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'granted', 'refused', 'adult')),
  decided_at timestamptz null,
  signer_guardian_user_id uuid null references public.profiles(id) on delete set null,
  signer_name text null,
  source text not null default 'manager'
    check (source in ('parent_portal', 'manager', 'import')),
  consent_version text null,
  internal_notes text null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, player_user_id)
);

create table if not exists public.player_consent_history (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  player_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'granted', 'refused', 'adult')),
  decided_at timestamptz null,
  signer_guardian_user_id uuid null references public.profiles(id) on delete set null,
  signer_name text null,
  source text not null check (source in ('parent_portal', 'manager', 'import')),
  consent_version text null,
  internal_notes text null,
  changed_by uuid null references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

alter table public.player_consents enable row level security;
alter table public.player_consent_history enable row level security;

create index if not exists idx_player_consent_history_player
  on public.player_consent_history (club_id, player_user_id, changed_at desc);

insert into public.player_consents (club_id, player_user_id, status, source, created_at, updated_at)
select
  cm.club_id,
  cm.user_id,
  coalesce(cm.player_consent_status, 'pending'),
  'import',
  coalesce(cm.created_at, now()),
  now()
from public.club_members cm
where cm.role = 'player'
on conflict (club_id, player_user_id) do nothing;

alter table if exists public.access_invitation_logs
  drop constraint if exists access_invitation_logs_kind_check;

alter table if exists public.access_invitation_logs
  add constraint access_invitation_logs_kind_check
  check (invitation_kind in ('parent_access', 'junior_access', 'consent_reminder'));
