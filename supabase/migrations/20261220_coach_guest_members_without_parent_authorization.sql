begin;

-- Planning invitations use active club membership independently of parental consent.
-- The attendee INSERT guard already delegates eligibility to this function.
create or replace function public.coach_training_guest_players(p_group_id uuid)
returns table(id uuid, first_name text, last_name text, avatar_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.first_name::text, p.last_name::text, p.avatar_url::text
  from public.coach_groups g
  join public.organization_members m on m.organization_id = g.club_id and m.role = 'player' and m.is_active
  join public.profiles p on p.id = m.user_id
  where g.id = p_group_id and g.is_active
    and public.can_manage_assigned_group(g.id, auth.uid(), 'planning')
    and public.organization_actor_legal_ready(g.club_id, auth.uid())
$$;
revoke all on function public.coach_training_guest_players(uuid) from public, anon;
grant execute on function public.coach_training_guest_players(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
