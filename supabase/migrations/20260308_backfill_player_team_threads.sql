-- Backfill team threads for existing player direct threads.
-- Participants = shared-group coaches + player + visible guardians.

do $$
declare
  r record;
  v_team_thread_id uuid;
  v_actor uuid;
begin
  for r in
    select distinct
      t.organization_id,
      t.player_id
    from public.message_threads t
    where t.thread_type = 'player'
      and t.player_id is not null
      and coalesce(t.player_thread_scope, 'direct') = 'direct'
  loop
    -- Pick one active coach sharing at least one group with the player.
    select cm.user_id
    into v_actor
    from public.coach_group_players gp
    join public.coach_groups g
      on g.id = gp.group_id
    join public.coach_group_coaches cgc
      on cgc.group_id = gp.group_id
    join public.club_members cm
      on cm.user_id = cgc.coach_user_id
     and cm.is_active = true
     and cm.role = 'coach'
    where gp.player_user_id = r.player_id
    order by cm.user_id
    limit 1;

    if v_actor is null then
      continue;
    end if;

    -- Ensure the team thread exists.
    select t.id
    into v_team_thread_id
    from public.message_threads t
    where t.organization_id = r.organization_id
      and t.thread_type = 'player'
      and t.player_id = r.player_id
      and t.player_thread_scope = 'team'
    limit 1;

    if v_team_thread_id is null then
      insert into public.message_threads (
        organization_id,
        thread_type,
        title,
        player_id,
        player_thread_scope,
        created_by,
        is_locked,
        is_active
      )
      values (
        r.organization_id,
        'player',
        'Fil équipe coachs + joueur + parent(s)',
        r.player_id,
        'team',
        v_actor,
        false,
        true
      )
      returning id into v_team_thread_id;
    end if;

    -- Participants of team thread = active coaches sharing at least one group with the player.
    insert into public.thread_participants (thread_id, user_id, can_post)
    select distinct
      v_team_thread_id,
      cm.user_id,
      true
    from public.coach_group_players gp
    join public.coach_groups g
      on g.id = gp.group_id
    join public.coach_group_coaches cgc
      on cgc.group_id = gp.group_id
    join public.club_members cm
      on cm.user_id = cgc.coach_user_id
     and cm.is_active = true
     and cm.role = 'coach'
    where gp.player_user_id = r.player_id
    on conflict (thread_id, user_id)
    do update set
      can_post = excluded.can_post,
      updated_at = now();

    -- Ensure player participates.
    insert into public.thread_participants (thread_id, user_id, can_post)
    values (v_team_thread_id, r.player_id, true)
    on conflict (thread_id, user_id)
    do update set
      can_post = excluded.can_post,
      updated_at = now();

    -- Ensure visible guardians participate.
    insert into public.thread_participants (thread_id, user_id, can_post)
    select
      v_team_thread_id,
      pg.guardian_user_id,
      true
    from public.player_guardians pg
    where pg.player_id = r.player_id
      and coalesce(pg.can_view, true) = true
    on conflict (thread_id, user_id)
    do update set
      can_post = excluded.can_post,
      updated_at = now();
  end loop;
end $$;
