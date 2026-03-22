create table if not exists public.club_parent_intake_configs (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  public_token uuid not null default gen_random_uuid() unique,
  is_enabled boolean not null default true,
  title text not null default 'Activation des comptes parents',
  subtitle text null,
  intro_text text not null default '',
  recipient_email text not null default 'info@activitee.golf',
  success_message text not null default 'Merci, votre formulaire a bien ete envoye.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_club_parent_intake_configs_token
  on public.club_parent_intake_configs (public_token);
