create table if not exists public.club_player_fields (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null,
  options_json jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  legacy_binding text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, field_key)
);

alter table if exists public.club_player_fields
  drop constraint if exists club_player_fields_field_type_check;

alter table if exists public.club_player_fields
  add constraint club_player_fields_field_type_check
  check (field_type in ('text', 'boolean', 'select'));

alter table if exists public.club_player_fields
  drop constraint if exists club_player_fields_legacy_binding_check;

alter table if exists public.club_player_fields
  add constraint club_player_fields_legacy_binding_check
  check (
    legacy_binding is null
    or legacy_binding in ('player_course_track', 'player_membership_paid', 'player_playing_right_paid')
  );

create index if not exists idx_club_player_fields_club_sort
  on public.club_player_fields (club_id, sort_order, created_at);

create table if not exists public.club_member_player_field_values (
  club_member_id uuid not null references public.club_members(id) on delete cascade,
  field_id uuid not null references public.club_player_fields(id) on delete cascade,
  value_text text null,
  value_bool boolean null,
  value_option text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_member_id, field_id)
);

create index if not exists idx_club_member_player_field_values_field
  on public.club_member_player_field_values (field_id, club_member_id);

insert into public.club_player_fields (club_id, field_key, label, field_type, options_json, is_active, sort_order, legacy_binding)
select
  c.id,
  x.field_key,
  x.label,
  x.field_type,
  x.options_json,
  true,
  x.sort_order,
  x.legacy_binding
from public.clubs c
cross join (
  values
    (
      'legacy_course_track',
      'Cours',
      'select',
      '["junior","competition","no_course"]'::jsonb,
      10,
      'player_course_track'
    ),
    (
      'legacy_membership_paid',
      'Cotisation',
      'boolean',
      '[]'::jsonb,
      20,
      'player_membership_paid'
    ),
    (
      'legacy_playing_right_paid',
      'Droit de jeu',
      'boolean',
      '[]'::jsonb,
      30,
      'player_playing_right_paid'
    )
) as x(field_key, label, field_type, options_json, sort_order, legacy_binding)
where not exists (
  select 1
  from public.club_player_fields f
  where f.club_id = c.id
    and f.field_key = x.field_key
);
