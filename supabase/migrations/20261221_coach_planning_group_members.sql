begin;

-- Group membership used to classify planning attendees is independent of consent.
create function public.coach_planning_group_player_ids(p_group_id uuid)
returns table(player_user_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select gp.player_user_id
  from public.coach_group_players gp
  join public.coach_training_guest_players(p_group_id) p on p.id = gp.player_user_id
  where gp.group_id = p_group_id
$$;
revoke all on function public.coach_planning_group_player_ids(uuid) from public, anon;
grant execute on function public.coach_planning_group_player_ids(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
