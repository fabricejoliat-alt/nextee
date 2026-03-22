create table if not exists public.club_access_invitation_mail_configs (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  parent_subject text not null,
  parent_body text not null,
  junior_subject text not null,
  junior_body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
