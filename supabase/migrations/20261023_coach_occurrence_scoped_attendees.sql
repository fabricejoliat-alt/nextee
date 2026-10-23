-- The Coach detail API filters attendees with organization_actor_access.
-- Compare that same visible scope and retain the other registrations atomically.
-- Preserve the legal wrapper (when installed), grants and all other stale checks.
begin;
do $migration$
declare
  target regprocedure := coalesce(
    to_regprocedure('public.update_coach_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)'),
    to_regprocedure('public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)'));
  definition text;
  old_block text := $old$    if v_ids is distinct from v_expected_ids then raise exception 'planning_conflict'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(category,minutes,note,position)$old$;
  new_block text := $new$    if v_ids is distinct from v_expected_ids then
      -- scoped_attendee_snapshot_v1: match exactly the attendees disclosed by the API.
      if v_expected_ids is distinct from (
        select coalesce(array_agg(player_id order by player_id),'{}'::uuid[])
        from public.club_event_attendees where event_id=p_event_id
          and public.organization_actor_access(p_org := v_event.club_id,
            p_actor := auth.uid(), p_player := player_id) is true
      ) then raise exception 'planning_conflict'; end if;
      -- Hidden registrations were never editable in this form. Keep their status,
      -- attendance and recorded work; never disclose their IDs to the browser.
      if p_player_ids is not null then
        select coalesce(array_agg(id order by id),'{}'::uuid[]) into p_player_ids
        from (
          select unnest(p_player_ids) as id
          union
          select player_id from public.club_event_attendees
            where event_id=p_event_id and not(player_id=any(v_expected_ids))
        ) retained;
      end if;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(category,minutes,note,position)$new$;
  old_insert text := $old$insert into public.club_event_attendees(event_id,player_id,status) select p_event_id,id,'present' from (select distinct unnest(p_player_ids) id) u
      on conflict(event_id,player_id) do nothing;$old$;
  new_insert text := $new$insert into public.club_event_attendees(event_id,player_id,status) select p_event_id,id,'present' from (select distinct unnest(p_player_ids) id) u
      -- skip_unchanged_attendee_insert_v1: do not invoke child-write guards on retained rows.
      where not exists(select 1 from public.club_event_attendees a where a.event_id=p_event_id and a.player_id=u.id)
      on conflict(event_id,player_id) do nothing;$new$;
begin
  if target is null then raise exception 'Coach occurrence save is not installed'; end if;
  select pg_get_functiondef(target) into definition;
  if position('scoped_attendee_snapshot_v1' in definition)=0 then
    if position(old_block in definition)=0 then
      raise exception 'Unexpected Coach occurrence save definition; no change applied';
    end if;
    definition := replace(definition,old_block,new_block);
  end if;
  if position(old_insert in definition)>0 then
    definition := replace(definition,old_insert,new_insert);
  elsif position('skip_unchanged_attendee_insert_v1' in definition)=0 then
    raise exception 'Unexpected Coach attendee insert definition; no change applied';
  end if;
  execute definition;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
