begin;

-- v2 delegates the individual save to v1. Keep its row locks, attendance
-- checks and the cancellation guard while changing the opening time.
do $migration$
declare
  definition text := pg_get_functiondef('public.save_coach_training_player_evaluation_v1(uuid,uuid,uuid,text,integer,integer,integer,text,text,boolean)'::regprocedure);
  previous text := $old$if coalesce(
    v_event.ends_at,
    v_event.starts_at + make_interval(mins => coalesce(v_event.duration_minutes, 0))
  ) > now() then raise exception 'event_not_finished'; end if;$old$;
begin
  if strpos(definition, previous) = 0 then raise exception 'Unexpected coach evaluation time guard'; end if;
  execute replace(definition, previous, 'if v_event.starts_at > now() then raise exception ''event_not_started''; end if;');
end
$migration$;

-- Basic identities for the guest picker. The caller must manage planning for
-- this group and the junior must have an active, authorized club membership.
create function public.coach_training_guest_players(p_group_id uuid)
returns table(id uuid, first_name text, last_name text, avatar_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.first_name::text, p.last_name::text, p.avatar_url::text
  from public.coach_groups g
  join public.organization_members m on m.organization_id = g.club_id and m.role = 'player' and m.is_active
  join public.profiles p on p.id = m.user_id
  where g.id = p_group_id and g.is_active
    and public.can_manage_assigned_group(g.id, auth.uid(), 'planning')
    and public.organization_actor_legal_ready(g.club_id, auth.uid())
    and public.organization_player_authorized(g.club_id, m.user_id)
    and not exists (select 1 from public.academy_roster_entries r
      where r.academy_id = g.club_id and r.player_id = m.user_id and r.status <> 'active')
$$;
revoke all on function public.coach_training_guest_players(uuid) from public, anon;
grant execute on function public.coach_training_guest_players(uuid) to authenticated;

-- Before the attendee exists, the event-scoped player check cannot yet grant
-- access. Permit this one registration using the same eligibility as the list.
do $migration$
declare
  definition text := pg_get_functiondef('public.organization_sports_child_write()'::regprocedure);
  previous text := 'or (row_data->>''event_id'' is not null and subject is not null and public.organization_event_player_access';
  replacement text := $new$or (tg_table_name = 'club_event_attendees' and tg_op = 'INSERT'
      and row_data->>'coach_recorded_status' is null and exists (
        select 1 from public.club_events e
        join public.coach_groups g on g.id = e.group_id and g.club_id = e.club_id
        where e.id = (row_data->>'event_id')::uuid and e.event_type = 'training' and e.status = 'scheduled'
          and exists (select 1 from public.coach_training_guest_players(g.id) guest where guest.id = subject)))
    $new$;
begin
  if strpos(definition, previous) = 0 then raise exception 'Unexpected attendee write guard'; end if;
  execute replace(definition, previous, replacement || previous);
end
$migration$;
notify pgrst, 'reload schema';
commit;
