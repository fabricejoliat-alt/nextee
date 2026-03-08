-- Optional job function/position for staff users (coach/manager).

alter table if exists public.profiles
  add column if not exists staff_function text null;

create index if not exists idx_profiles_staff_function
  on public.profiles (staff_function);

