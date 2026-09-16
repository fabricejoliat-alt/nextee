alter table if exists public.club_members
  add column if not exists can_manage_assigned_groups boolean not null default false,
  add column if not exists can_manage_assigned_group_planning boolean not null default false,
  add column if not exists can_transfer_players_between_club_groups boolean not null default false;

comment on column public.club_members.can_manage_assigned_groups is
  'Allows a coach to manage the composition and operational information of groups explicitly assigned to them.';
comment on column public.club_members.can_manage_assigned_group_planning is
  'Allows a coach to plan activities for groups explicitly assigned to them.';
comment on column public.club_members.can_transfer_players_between_club_groups is
  'Allows a coach to transfer players between groups within this club.';

create table if not exists public.coach_player_group_transfers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  player_user_id uuid not null references public.profiles(id) on delete restrict,
  source_group_id uuid references public.coach_groups(id) on delete set null,
  destination_group_id uuid not null references public.coach_groups(id) on delete restrict,
  performed_by uuid not null references public.profiles(id) on delete restrict,
  future_events_action text not null default 'keep' check (future_events_action in ('keep', 'remove_old', 'move')),
  created_at timestamptz not null default now()
);

create index if not exists coach_player_group_transfers_club_player_created_idx
  on public.coach_player_group_transfers (club_id, player_user_id, created_at desc);

alter table public.coach_player_group_transfers enable row level security;

drop policy if exists "club_managers_read_group_transfers" on public.coach_player_group_transfers;
create policy "club_managers_read_group_transfers"
on public.coach_player_group_transfers for select to authenticated
using (exists (
  select 1 from public.club_members membership
  where membership.club_id = coach_player_group_transfers.club_id
    and membership.user_id = auth.uid()
    and membership.role = 'manager'
    and membership.is_active = true
));

drop policy if exists "head_coaches_read_own_group_transfers" on public.coach_player_group_transfers;
create policy "head_coaches_read_own_group_transfers"
on public.coach_player_group_transfers for select to authenticated
using (performed_by = auth.uid());

create or replace function public.can_manage_assigned_group(p_group_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.coach_groups g
    join public.club_members cm on cm.club_id = g.club_id
      and cm.user_id = p_user_id and cm.is_active = true
    where g.id = p_group_id
      and (
        cm.role = 'manager'
        or (
          cm.role = 'coach'
          and (g.head_coach_user_id = p_user_id or exists (
            select 1 from public.coach_group_coaches cgc
            where cgc.group_id = g.id and cgc.coach_user_id = p_user_id
          ))
          and case p_permission
            when 'groups' then cm.can_manage_assigned_groups
            when 'planning' then cm.can_manage_assigned_group_planning
            else false
          end
        )
      )
  );
$$;

grant execute on function public.can_manage_assigned_group(uuid, uuid, text) to authenticated;

drop policy if exists "group_staff_can_insert_club_events" on public.club_events;
create policy "group_staff_can_insert_club_events" on public.club_events
for insert to authenticated
with check (public.can_manage_assigned_group(club_events.group_id, auth.uid(), 'planning'));

drop policy if exists "group_staff_can_update_club_events" on public.club_events;
create policy "group_staff_can_update_club_events" on public.club_events
for update to authenticated
using (public.can_manage_assigned_group(club_events.group_id, auth.uid(), 'planning'))
with check (public.can_manage_assigned_group(club_events.group_id, auth.uid(), 'planning'));

drop policy if exists "group_staff_can_delete_club_events" on public.club_events;
create policy "group_staff_can_delete_club_events" on public.club_events
for delete to authenticated
using (public.can_manage_assigned_group(club_events.group_id, auth.uid(), 'planning'));

create or replace function public.coach_transfer_player_group(
  p_actor_user_id uuid,
  p_player_user_id uuid,
  p_source_group_id uuid,
  p_destination_group_id uuid,
  p_future_events_action text default 'keep'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_source_club_id uuid;
  v_transfer_id uuid;
begin
  if p_future_events_action not in ('keep', 'remove_old', 'move') then
    raise exception 'Invalid future events action';
  end if;
  if p_source_group_id = p_destination_group_id then
    raise exception 'Source and destination groups must differ';
  end if;

  select club_id into v_club_id from public.coach_groups where id = p_destination_group_id and is_active = true;
  select club_id into v_source_club_id from public.coach_groups where id = p_source_group_id;
  if v_club_id is null or v_source_club_id is distinct from v_club_id then
    raise exception 'Groups must belong to the same club';
  end if;
  if not exists (
    select 1 from public.club_members cm
    where cm.club_id = v_club_id and cm.user_id = p_actor_user_id and cm.role = 'coach'
      and cm.is_active = true and cm.can_transfer_players_between_club_groups = true
  ) then
    raise exception 'Forbidden';
  end if;
  if not exists (
    select 1 from public.club_members cm
    where cm.club_id = v_club_id and cm.user_id = p_player_user_id and cm.role = 'player' and cm.is_active = true
  ) then
    raise exception 'Player is not active in this club';
  end if;
  if not exists (
    select 1 from public.coach_group_players gp
    where gp.group_id = p_source_group_id and gp.player_user_id = p_player_user_id
  ) then
    raise exception 'Player is not in the source group';
  end if;

  insert into public.coach_group_players (group_id, player_user_id)
  select p_destination_group_id, p_player_user_id
  where not exists (
    select 1 from public.coach_group_players gp
    where gp.group_id = p_destination_group_id and gp.player_user_id = p_player_user_id
  );
  delete from public.coach_group_players
  where group_id = p_source_group_id and player_user_id = p_player_user_id;

  if p_future_events_action in ('remove_old', 'move') then
    delete from public.club_event_attendees attendee
    using public.club_events event
    where attendee.event_id = event.id and attendee.player_id = p_player_user_id
      and event.group_id = p_source_group_id and event.starts_at > now();
  end if;
  if p_future_events_action = 'move' then
    insert into public.club_event_attendees (event_id, player_id, status)
    select event.id, p_player_user_id, 'expected'
    from public.club_events event
    where event.group_id = p_destination_group_id and event.starts_at > now() and event.status = 'scheduled'
      and not exists (
        select 1 from public.club_event_attendees attendee
        where attendee.event_id = event.id and attendee.player_id = p_player_user_id
      );
  end if;

  insert into public.coach_player_group_transfers (
    club_id, player_user_id, source_group_id, destination_group_id, performed_by, future_events_action
  ) values (
    v_club_id, p_player_user_id, p_source_group_id, p_destination_group_id, p_actor_user_id, p_future_events_action
  ) returning id into v_transfer_id;
  return v_transfer_id;
end;
$$;

revoke all on function public.coach_transfer_player_group(uuid, uuid, uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.coach_transfer_player_group(uuid, uuid, uuid, uuid, text) to service_role;
