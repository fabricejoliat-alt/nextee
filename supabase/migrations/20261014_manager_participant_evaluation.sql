-- Manager participant evaluation: one validated transaction, with optimistic concurrency.
-- Requires 20261002 (Manager feedback) and 20261009 (Manager club scope).
begin;
create or replace function public.get_manager_evaluation_snapshot_v1(p_event_id uuid,p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event public.club_events%rowtype; v_attendee public.club_event_attendees%rowtype;
begin
  select * into v_event from public.club_events where id=p_event_id;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),v_event.club_id);
  select * into v_attendee from public.club_event_attendees where event_id=p_event_id and player_id=p_player_id;
  if v_attendee.player_id is null then raise exception 'unknown_attendee'; end if;
  return jsonb_build_object(
    'event',jsonb_build_object('id',v_event.id,'group_id',v_event.group_id,'club_id',v_event.club_id,'status',v_event.status,
      'event_type',v_event.event_type,'starts_at',v_event.starts_at,'ends_at',v_event.ends_at,'duration_minutes',v_event.duration_minutes,'requires_evaluation',v_event.requires_evaluation),
    'attendee',jsonb_build_object('player_id',v_attendee.player_id,'status',v_attendee.status,'coach_recorded_status',v_attendee.coach_recorded_status,
      'coach_recorded_by',v_attendee.coach_recorded_by,'coach_recorded_at',v_attendee.coach_recorded_at),
    'feedback',coalesce((select jsonb_agg(to_jsonb(f) order by (f.coach_id=auth.uid()) desc,f.coach_id) from public.club_event_coach_feedback f where event_id=p_event_id and player_id=p_player_id),'[]'::jsonb),
    'criteria',coalesce((select jsonb_agg(to_jsonb(c) order by c.position,c.id) from public.club_event_evaluation_criteria c where event_id=p_event_id and is_enabled and snapshot_respondent in ('coach','both')),'[]'::jsonb),
    'responses',coalesce((select jsonb_agg(to_jsonb(r) order by r.event_criterion_id) from public.club_event_evaluation_responses r where event_id=p_event_id and player_id=p_player_id and respondent_role='coach'),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_manager_evaluation_snapshot_v1(uuid,uuid) from public,anon;
grant execute on function public.get_manager_evaluation_snapshot_v1(uuid,uuid) to authenticated;

create or replace function public.save_manager_event_feedback_v2(p_event_id uuid,p_player_id uuid,p_expected jsonb,p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event public.club_events%rowtype; v_attendee public.club_event_attendees%rowtype;
  v_snapshot jsonb; v_feedback jsonb; v_previous jsonb; v_answers jsonb; v_answer jsonb; v_key text;
  v_status text:=p_values->>'attendance'; v_criterion public.club_event_evaluation_criteria%rowtype;
  v_notify boolean:=false;
begin
  select * into v_event from public.club_events where id=p_event_id for update;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),v_event.club_id);
  select * into v_attendee from public.club_event_attendees where event_id=p_event_id and player_id=p_player_id for update;
  if v_attendee.player_id is null then raise exception 'unknown_attendee'; end if;
  if v_event.status='cancelled' then raise exception 'event_cancelled'; end if;
  if not coalesce(v_event.requires_evaluation,false) then raise exception 'evaluation_disabled'; end if;
  if coalesce(v_event.ends_at,v_event.starts_at+make_interval(mins=>v_event.duration_minutes))>now() then raise exception 'event_not_finished'; end if;
  perform 1 from public.club_event_coach_feedback where event_id=p_event_id and player_id=p_player_id for update;
  perform 1 from public.club_event_evaluation_criteria where event_id=p_event_id for share;
  perform 1 from public.club_event_evaluation_responses where event_id=p_event_id and player_id=p_player_id and respondent_role='coach' for update;
  v_snapshot:=public.get_manager_evaluation_snapshot_v1(p_event_id,p_player_id);
  if p_expected is null or v_snapshot is distinct from p_expected then raise exception 'evaluation_conflict'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' or v_status is null or v_status not in ('present','absent') then raise exception 'attendance_required'; end if;
  v_feedback:=p_values->'feedback'; v_answers:=p_values->'responses';
  if jsonb_typeof(v_feedback) is distinct from 'object' or jsonb_typeof(v_answers) is distinct from 'object' then raise exception 'invalid_feedback'; end if;
  if char_length(coalesce(v_feedback->>'private_note',''))>4000 or char_length(coalesce(v_feedback->>'player_note',''))>4000 then raise exception 'invalid_note'; end if;
  if v_status='present' and (
    (v_feedback->>'engagement')::integer is null or (v_feedback->>'engagement')::integer not between 1 and 6 or
    (v_feedback->>'attitude')::integer is null or (v_feedback->>'attitude')::integer not between 1 and 6 or
    (v_feedback->>'performance')::integer is null or (v_feedback->>'performance')::integer not between 1 and 6
  ) then raise exception 'ratings_required'; end if;
  for v_key in select jsonb_object_keys(v_answers) loop
    if not exists(select 1 from public.club_event_evaluation_criteria where id::text=v_key and event_id=p_event_id and is_enabled and snapshot_respondent in ('coach','both')) then raise exception 'invalid_custom_criterion'; end if;
  end loop;
  if v_status='present' then
    for v_criterion in select * from public.club_event_evaluation_criteria where event_id=p_event_id and is_enabled and snapshot_respondent in ('coach','both') loop
      v_answer:=v_answers->v_criterion.id::text;
      if v_answer is null or v_answer='null'::jsonb or v_answer='""'::jsonb then
        if v_criterion.snapshot_is_required then raise exception 'required_criteria_missing'; end if;
      elsif v_criterion.snapshot_response_format='short_text' then
        if jsonb_typeof(v_answer)<>'string' or char_length(btrim(v_answer#>>'{}')) not between 1 and 240 then raise exception 'invalid_custom_response'; end if;
      elsif not exists(select 1 from jsonb_array_elements(v_criterion.snapshot_choices) c where c->'value'=v_answer) then raise exception 'invalid_custom_response'; end if;
    end loop;
  else
    v_feedback:=v_feedback||jsonb_build_object('engagement',null,'attitude',null,'performance',null,'visible_to_player',false,'player_note',null);
  end if;
  v_previous:=v_snapshot->'feedback'->0;
  -- Only a new/changed visible assessment may notify the junior. Private notes never do.
  v_notify:=v_status='present' and coalesce((v_feedback->>'visible_to_player')::boolean,false) and (
    not coalesce((v_previous->>'visible_to_player')::boolean,false) or
    jsonb_build_array(v_feedback->'engagement',v_feedback->'attitude',v_feedback->'performance',nullif(btrim(v_feedback->>'player_note'),'')) is distinct from
    jsonb_build_array(v_previous->'engagement',v_previous->'attitude',v_previous->'performance',nullif(btrim(v_previous->>'player_note'),'')));
  -- Preserve evaluations authored by other coaches. This function only updates the Manager's row.
  perform public.save_manager_event_feedback_v1(p_event_id,p_player_id,v_feedback);
  update public.club_event_attendees set status=v_status,coach_recorded_status=v_status,coach_recorded_by=auth.uid(),coach_recorded_at=clock_timestamp()
    where event_id=p_event_id and player_id=p_player_id;
  delete from public.club_event_evaluation_responses r where event_id=p_event_id and player_id=p_player_id and respondent_role='coach'
    and exists(select 1 from public.club_event_evaluation_criteria c where c.id=r.event_criterion_id and c.is_enabled and c.snapshot_respondent in ('coach','both'));
  if v_status='present' then
    insert into public.club_event_evaluation_responses(club_id,event_id,event_criterion_id,player_id,respondent_user_id,respondent_role,value_json)
      select v_event.club_id,p_event_id,c.id,p_player_id,auth.uid(),'coach',v_answers->c.id::text from public.club_event_evaluation_criteria c
      where c.event_id=p_event_id and c.is_enabled and c.snapshot_respondent in ('coach','both') and v_answers?c.id::text and v_answers->c.id::text not in ('null'::jsonb,'""'::jsonb);
  end if;
  return jsonb_build_object('ok',true,'notification_required',coalesce(v_notify,false));
end;
$$;
revoke all on function public.save_manager_event_feedback_v2(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_manager_event_feedback_v2(uuid,uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
