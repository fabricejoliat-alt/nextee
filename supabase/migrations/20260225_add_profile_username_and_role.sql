-- Add login-friendly username and default app role on profiles.

alter table if exists public.profiles
  add column if not exists username text,
  add column if not exists app_role text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_app_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_app_role_check
      check (app_role in ('manager', 'coach', 'player', 'parent', 'captain', 'staff') or app_role is null);
  end if;
end $$;

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

