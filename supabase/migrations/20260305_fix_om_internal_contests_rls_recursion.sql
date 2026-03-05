-- Fix RLS recursion between om_internal_contests and om_internal_contest_results.
-- Root cause:
-- - contests select policy checked existence in results
-- - results select policy checked existence in contests
-- => recursive policy evaluation.

create or replace function public.can_user_read_internal_contest(
  p_contest_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.om_internal_contests c
    where c.id = p_contest_id
      and public.is_org_staff_member(c.organization_id, p_user_id)
  )
  or exists (
    select 1
    from public.om_internal_contest_results r
    where r.contest_id = p_contest_id
      and r.player_id = p_user_id
  )
  or exists (
    select 1
    from public.om_internal_contest_results r
    join public.player_guardians pg
      on pg.player_id = r.player_id
     and pg.guardian_user_id = p_user_id
     and coalesce(pg.can_view, true) = true
    where r.contest_id = p_contest_id
  );
$$;

grant execute on function public.can_user_read_internal_contest(uuid, uuid) to authenticated;

alter table if exists public.om_internal_contests enable row level security;
alter table if exists public.om_internal_contest_results enable row level security;

drop policy if exists "org_staff_or_players_can_select_om_internal_contests" on public.om_internal_contests;
drop policy if exists "org_staff_can_select_om_internal_contests" on public.om_internal_contests;
create policy "user_can_select_om_internal_contests"
on public.om_internal_contests
for select
to authenticated
using (
  public.can_user_read_internal_contest(om_internal_contests.id, auth.uid())
);

drop policy if exists "org_staff_can_select_om_internal_contest_results" on public.om_internal_contest_results;
create policy "user_can_select_om_internal_contest_results"
on public.om_internal_contest_results
for select
to authenticated
using (
  public.can_user_read_internal_contest(om_internal_contest_results.contest_id, auth.uid())
);

