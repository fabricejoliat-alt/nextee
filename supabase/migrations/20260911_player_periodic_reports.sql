-- Periodic parental reports. Additive and independent from existing invitations.

alter table if exists public.club_access_invitation_mail_configs
  add column if not exists periodic_report_subject text,
  add column if not exists periodic_report_body text;

create table if not exists public.player_periodic_report_configs (
  club_id uuid not null references public.clubs(id) on delete cascade,
  player_user_id uuid not null references public.profiles(id) on delete cascade,
  is_enabled boolean not null default false,
  frequency text not null default 'monthly' check (frequency in ('monthly','quarterly','semiannual')),
  send_day smallint not null default 5 check (send_day between 1 and 28),
  timezone text not null default 'Europe/Zurich',
  locale text not null default 'fr' check (locale in ('fr','de','it','en')),
  recipient_user_ids uuid[] not null default '{}',
  sections jsonb not null default '{"attendance":true,"training":true,"competitions":true,"handicap":true,"evaluations":true,"coach_comment":true,"upcoming":true}'::jsonb,
  coach_priority text null,
  coach_objective text null,
  coach_encouragement text null,
  coach_comment text null,
  next_send_at timestamptz null,
  last_sent_at timestamptz null,
  last_status text null check (last_status is null or last_status in ('pending','sent','failed','skipped')),
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, player_user_id)
);

create index if not exists player_periodic_report_configs_due_idx
  on public.player_periodic_report_configs (is_enabled, next_send_at)
  where is_enabled;

create table if not exists public.player_periodic_reports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  player_user_id uuid not null references public.profiles(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  period_label text not null,
  statistics_snapshot jsonb not null,
  published_content jsonb not null,
  personalized_comment text null,
  generated_by uuid null references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique (club_id, player_user_id, period_from, period_to)
);

create index if not exists player_periodic_reports_player_idx
  on public.player_periodic_reports (club_id, player_user_id, period_to desc);

create table if not exists public.player_periodic_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  report_ids uuid[] not null,
  player_user_ids uuid[] not null,
  period_from date not null,
  period_to date not null,
  locale text not null default 'fr',
  delivery_mode text not null check (delivery_mode in ('automatic','manual','test')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  provider_message_id text null,
  error_message text null,
  attempt_count integer not null default 0,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists player_periodic_report_deliveries_auto_unique
  on public.player_periodic_report_deliveries (club_id, recipient_user_id, period_from, period_to, locale)
  where delivery_mode = 'automatic';
create index if not exists player_periodic_report_deliveries_history_idx
  on public.player_periodic_report_deliveries (club_id, created_at desc);
create index if not exists player_periodic_report_deliveries_players_gin_idx
  on public.player_periodic_report_deliveries using gin (player_user_ids);

alter table public.player_periodic_report_configs enable row level security;
alter table public.player_periodic_reports enable row level security;
alter table public.player_periodic_report_deliveries enable row level security;

drop policy if exists "parent_can_read_own_periodic_reports" on public.player_periodic_reports;
create policy "parent_can_read_own_periodic_reports" on public.player_periodic_reports
for select using (
  exists (
    select 1 from public.player_guardians pg
    where pg.player_id = player_periodic_reports.player_user_id
      and pg.guardian_user_id = auth.uid()
      and pg.can_view is not false
  )
);

drop policy if exists "parent_can_read_own_periodic_deliveries" on public.player_periodic_report_deliveries;
create policy "parent_can_read_own_periodic_deliveries" on public.player_periodic_report_deliveries
for select using (recipient_user_id = auth.uid());
