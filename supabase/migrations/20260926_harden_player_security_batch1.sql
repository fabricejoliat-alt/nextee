-- Batch 1 security hardening for verified birth dates and organization-scoped
-- player team threads. This migration is intentionally not applied by Codex.

create or replace function public.prevent_player_self_birth_date_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.birth_date is distinct from old.birth_date
     and auth.role() = 'authenticated'
     and auth.uid() = old.id
     and exists (
       select 1
       from public.club_members cm
       where cm.user_id = old.id
         and cm.role = 'player'
         and cm.is_active = true
     ) then
    raise exception 'A player birth date must be verified by club staff'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_player_self_birth_date_change on public.profiles;
create trigger trg_prevent_player_self_birth_date_change
before update of birth_date on public.profiles
for each row execute function public.prevent_player_self_birth_date_change();

create or replace function public.is_valid_player_team_thread_participant(
  p_thread_id uuid,
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
    from public.message_threads t
    where t.id = p_thread_id
      and t.thread_type = 'player'
      and t.player_thread_scope = 'team'
      and t.player_id is not null
      and (
        (
          p_user_id = t.player_id
          and exists (
            select 1
            from public.club_members player_membership
            where player_membership.club_id = t.organization_id
              and player_membership.user_id = t.player_id
              and player_membership.role = 'player'
              and player_membership.is_active = true
          )
        )
        or exists (
          select 1
          from public.player_guardians pg
          where pg.player_id = t.player_id
            and pg.guardian_user_id = p_user_id
            and coalesce(pg.can_view, true) = true
        )
        or exists (
          select 1
          from public.coach_group_players cgp
          join public.coach_groups cg
            on cg.id = cgp.group_id
           and cg.club_id = t.organization_id
          join public.coach_group_coaches cgc
            on cgc.group_id = cgp.group_id
           and cgc.coach_user_id = p_user_id
          join public.club_members coach_membership
            on coach_membership.club_id = t.organization_id
           and coach_membership.user_id = p_user_id
           and coach_membership.role = 'coach'
           and coach_membership.is_active = true
          where cgp.player_user_id = t.player_id
        )
      )
  );
$$;

create or replace function public.enforce_player_team_thread_participant_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.message_threads t
    where t.id = new.thread_id
      and t.thread_type = 'player'
      and t.player_thread_scope = 'team'
  ) and not public.is_valid_player_team_thread_participant(new.thread_id, new.user_id) then
    raise exception 'Invalid participant for player team thread organization'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_player_team_thread_participant_scope on public.thread_participants;
create trigger trg_enforce_player_team_thread_participant_scope
before insert or update of thread_id, user_id on public.thread_participants
for each row execute function public.enforce_player_team_thread_participant_scope();

delete from public.thread_participants tp
using public.message_threads t
where tp.thread_id = t.id
  and t.thread_type = 'player'
  and t.player_thread_scope = 'team'
  and not public.is_valid_player_team_thread_participant(tp.thread_id, tp.user_id);
