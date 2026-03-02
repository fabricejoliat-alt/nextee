-- Fix RLS recursion on coach_group_coaches by avoiding self-referential checks.

create or replace function public.is_group_staff_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = p_user_id
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = p_user_id
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = p_group_id
      and (
        g.head_coach_user_id = p_user_id
        or cgc.coach_user_id is not null
        or cm.user_id is not null
      )
  );
$$;

grant execute on function public.is_group_staff_member(uuid, uuid) to authenticated;

alter table if exists public.coach_group_coaches enable row level security;
alter table if exists public.coach_group_players enable row level security;

drop policy if exists "group_staff_can_select_coach_group_coaches" on public.coach_group_coaches;
create policy "group_staff_can_select_coach_group_coaches"
on public.coach_group_coaches
for select
to authenticated
using (
  public.is_group_staff_member(coach_group_coaches.group_id, auth.uid())
);

drop policy if exists "group_staff_can_select_coach_group_players" on public.coach_group_players;
create policy "group_staff_can_select_coach_group_players"
on public.coach_group_players
for select
to authenticated
using (
  public.is_group_staff_member(coach_group_players.group_id, auth.uid())
);
