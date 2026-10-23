-- Return only recipients who can actually receive an organization notification.
-- Their registrations stay untouched; no notification is sent by this migration.
begin;
do $migration$
declare
  target regprocedure := coalesce(
    to_regprocedure('public.update_coach_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)'),
    to_regprocedure('public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)'));
  definition text;
  old_block text := $old$and coalesce(a.coach_recorded_status,'present') <> 'absent'
      and (v_event.event_type$old$;
  new_block text := $new$and coalesce(a.coach_recorded_status,'present') <> 'absent'
      -- eligible_occurrence_recipient_v1: same access gates as organization_notification_visible.
      and public.organization_actor_legal_ready(v_event.club_id,a.player_id)
      and public.organization_actor_access(p_org := v_event.club_id,p_actor := a.player_id,p_player := null)
      and (v_event.event_type$new$;
begin
  if target is null then raise exception 'Coach occurrence save is not installed'; end if;
  select pg_get_functiondef(target) into definition;
  if position('eligible_occurrence_recipient_v1' in definition)>0 then return; end if;
  if position(old_block in definition)=0 then raise exception 'Unexpected recipient query; no change applied'; end if;
  execute replace(definition,old_block,new_block);
end;
$migration$;
notify pgrst, 'reload schema';
commit;
