-- Manager training volume module
-- Stores editable FTEM targets and season/off-season month configuration per organization.

create table if not exists public.training_volume_settings (
  organization_id uuid primary key references public.clubs(id) on delete cascade,
  season_months smallint[] not null default '{4,5,6,7,8,9,10}',
  offseason_months smallint[] not null default '{11,12,1,2,3}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_volume_settings_months_check check (
    season_months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]
    and offseason_months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]
  )
);

create table if not exists public.training_volume_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clubs(id) on delete cascade,
  ftem_code text not null,
  level_label text not null,
  handicap_label text not null,
  handicap_min numeric(6,2) null,
  handicap_max numeric(6,2) null,
  minutes_offseason integer not null default 0,
  minutes_inseason integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_volume_targets_minutes_check check (
    minutes_offseason >= 0 and minutes_inseason >= 0
  ),
  constraint training_volume_targets_org_code_unique unique (organization_id, ftem_code)
);

create index if not exists idx_training_volume_targets_org_sort
  on public.training_volume_targets (organization_id, sort_order, ftem_code);
