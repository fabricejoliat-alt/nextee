-- Team player threads must include:
-- - active coaches sharing at least one group with the player
-- - the player
-- - the player's visible guardians (parents)

delete from public.thread_participants tp
using public.message_threads t
where tp.thread_id = t.id
  and t.thread_type = 'player'
  and coalesce(t.player_thread_scope, 'direct') = 'team'
  and tp.user_id <> t.player_id
  and not exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = t.player_id
      and pg.guardian_user_id = tp.user_id
      and coalesce(pg.can_view, true) = true
  )
  and not exists (
    select 1
    from public.coach_group_players gp
    join public.coach_group_coaches cgc
      on cgc.group_id = gp.group_id
    join public.club_members cm
      on cm.user_id = cgc.coach_user_id
     and cm.is_active = true
     and cm.role = 'coach'
    where gp.player_user_id = t.player_id
      and cgc.coach_user_id = tp.user_id
  );
