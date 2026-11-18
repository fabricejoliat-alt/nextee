begin;
-- Assigned training staff can evaluate every active club junior registered for the session.
create or replace function public.organization_event_player_access(p_actor uuid,p_event uuid,p_player uuid,p_edit boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.club_events e where e.id=p_event
    and public.organization_actor_legal_ready(e.club_id,p_actor)
    and exists(select 1 from public.organization_members m where m.organization_id=e.club_id and m.user_id=p_player and m.role='player' and m.is_active)

    and exists(select 1 from public.club_event_attendees a where a.event_id=e.id and a.player_id=p_player)
    and (
      (e.event_type='training' and e.status<>'cancelled'
        and exists(select 1 from public.organization_members staff
          where staff.organization_id=e.club_id and staff.user_id=p_actor and staff.is_active
            and staff.role in ('coach','manager')
            and (staff.role='manager'
              or public.is_group_staff_member(e.group_id,p_actor)
              or exists(select 1 from public.club_event_coaches c where c.event_id=e.id and c.coach_id=p_actor))))
      or (public.organization_player_authorized(e.club_id,p_player)
        and not exists(select 1 from public.academy_roster_entries r where r.academy_id=e.club_id and r.player_id=p_player and r.status<>'active')
        and (public.organization_actor_access(e.club_id,p_actor,p_player,p_edit)
          or (e.status<>'cancelled' and exists(select 1 from public.organization_members m where m.organization_id=e.club_id and m.user_id=p_actor and m.role='coach' and m.is_active)
            and exists(select 1 from public.club_event_coaches c where c.event_id=e.id and c.coach_id=p_actor))))
    ));
$$;
revoke all on function public.organization_event_player_access(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.organization_event_player_access(uuid,uuid,uuid,boolean) to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
