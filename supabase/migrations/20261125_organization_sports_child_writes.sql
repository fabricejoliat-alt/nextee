begin;
create function public.organization_event_player_access(p_actor uuid,p_event uuid,p_player uuid,p_edit boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.club_events e where e.id=p_event
    and public.organization_actor_legal_ready(e.club_id,p_actor)
    and exists(select 1 from public.organization_members m where m.organization_id=e.club_id and m.user_id=p_player and m.role='player' and m.is_active)
    and public.organization_player_authorized(e.club_id,p_player)
    and not exists(select 1 from public.academy_roster_entries r where r.academy_id=e.club_id and r.player_id=p_player and r.status<>'active')
    and exists(select 1 from public.club_event_attendees a where a.event_id=e.id and a.player_id=p_player)
    and (public.organization_actor_access(e.club_id,p_actor,p_player,p_edit)
      or (e.status<>'cancelled' and exists(select 1 from public.organization_members m where m.organization_id=e.club_id and m.user_id=p_actor and m.role='coach' and m.is_active)
        and exists(select 1 from public.club_event_coaches c where c.event_id=e.id and c.coach_id=p_actor))));
$$;
revoke all on function public.organization_event_player_access(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.organization_event_player_access(uuid,uuid,uuid,boolean) to authenticated,service_role;
-- Triggers also run inside older SECURITY DEFINER RPCs; RLS alone cannot
-- enforce a parent's per-child editing rights in those routines.
create function public.organization_sports_child_write() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb; previous jsonb; owner uuid; subject uuid; parent_owner uuid; parent_subject uuid; begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  owner:=coalesce(nullif(row_data->>'organization_id','')::uuid,nullif(row_data->>'club_id','')::uuid);
  subject:=coalesce(nullif(row_data->>'player_user_id','')::uuid,nullif(row_data->>'player_id','')::uuid,nullif(row_data->>'user_id','')::uuid);
  if tg_table_name in ('training_session_items','golf_round_holes','player_camp_days') then
    if tg_table_name='training_session_items' then select club_id,user_id into parent_owner,parent_subject from public.training_sessions where id=(row_data->>'session_id')::uuid;
    elsif tg_table_name='golf_round_holes' then select club_id,user_id into parent_owner,parent_subject from public.golf_rounds where id=(row_data->>'round_id')::uuid;
    else select organization_id,user_id into parent_owner,parent_subject from public.player_camps where id=(row_data->>'camp_id')::uuid; end if;
    owner:=parent_owner; subject:=parent_subject;
  elsif row_data->>'event_id' is not null then
    select club_id into parent_owner from public.club_events where id=(row_data->>'event_id')::uuid;
    if owner is not null and owner is distinct from parent_owner then raise exception 'Event organization mismatch' using errcode='42501'; end if;
    owner:=parent_owner;
  end if;
  -- A checked parent delete causes an FK cascade after the parent row is gone.
  if tg_op='DELETE' and pg_trigger_depth()>1 and owner is null then return old; end if;
  if owner is null then raise exception 'Organization owner required' using errcode='42501'; end if;
  if tg_op='UPDATE' then
    previous:=to_jsonb(old);
    if coalesce(previous->>'organization_id',previous->>'club_id') is distinct from coalesce(row_data->>'organization_id',row_data->>'club_id')
      or previous->>'session_id' is distinct from row_data->>'session_id'
      or previous->>'round_id' is distinct from row_data->>'round_id'
      or previous->>'camp_id' is distinct from row_data->>'camp_id'
      or previous->>'event_id' is distinct from row_data->>'event_id'
      or previous->>'user_id' is distinct from row_data->>'user_id'
      or previous->>'player_id' is distinct from row_data->>'player_id'
      or previous->>'player_user_id' is distinct from row_data->>'player_user_id' then
      raise exception 'Organization owner is immutable' using errcode='42501';
    end if;
  end if;
  -- Some general events also contain adult staff attendees.
  if tg_table_name='club_event_attendees' and not exists(select 1 from public.organization_members where organization_id=owner and user_id=subject and role='player') then subject:=null; end if;
  if auth.role()='authenticated' and (not (public.organization_actor_access(owner,auth.uid(),subject,true)
    or (row_data->>'event_id' is not null and subject is not null and public.organization_event_player_access(auth.uid(),(row_data->>'event_id')::uuid,subject,true)))
    or not public.organization_actor_legal_ready(owner,auth.uid())) then
    raise exception 'Organization editing forbidden' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.organization_sports_child_write() from public,anon,authenticated;
do $$ declare tbl text; begin
  foreach tbl in array array['training_session_items','golf_round_holes','player_camp_days','club_event_attendees',
    'club_event_evaluation_responses','club_event_coach_feedback','coach_player_private_notes','coach_training_debriefs',
    'player_dashboard_documents','player_periodic_reports','player_periodic_report_deliveries',
    'training_sessions','golf_rounds','player_activity_events','player_camps','player_validation_attempts'] loop
    execute format('create trigger organization_sports_child_write before %s on public.%I for each row execute function public.organization_sports_child_write()',
      case when tbl in ('training_sessions','golf_rounds','player_activity_events','player_camps','player_validation_attempts') then 'delete' else 'insert or update or delete' end,tbl);
  end loop;
end $$;
commit;
