-- Calendar URLs are bearer credentials for a narrow, read-only schedule.
-- Only the server may read or mutate them; no client RLS policy is granted.
create table if not exists public.calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('player', 'coach', 'manager')),
  scope_key text not null,
  player_id uuid references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  locale text not null default 'fr' check (locale in ('fr', 'en', 'de', 'it')),
  created_at timestamptz not null default now(),
  unique (user_id, kind, scope_key),
  check (
    (kind = 'player' and player_id is not null and organization_id is null and scope_key = player_id::text)
    or (kind = 'coach' and player_id is null and scope_key = coalesce(organization_id::text, 'all'))
    or (kind = 'manager' and player_id is null and organization_id is null and scope_key = 'all')
  )
);

alter table public.calendar_subscriptions enable row level security;
revoke all on public.calendar_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.calendar_subscriptions to service_role;
comment on table public.calendar_subscriptions is 'Private calendar subscription credentials; server authorization is rechecked on every feed read.';
