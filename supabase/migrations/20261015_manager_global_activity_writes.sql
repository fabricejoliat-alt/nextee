-- Atomic global activity creation and competition edits. Requires 20261009 and 20261013.
begin;
create table if not exists public.manager_activity_creation_requests (
  actor_id uuid not null, request_id uuid not null, payload jsonb not null, result jsonb,
  created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
alter table public.manager_activity_creation_requests enable row level security;
revoke all on public.manager_activity_creation_requests from public,anon,authenticated;

-- Shared validation for the competition form; no writes.
create or replace function public.manager_validate_competition_v1(p_payload jsonb,p_reminder_editable boolean default true)
returns void language plpgsql set search_path='' as $$
declare v_start timestamptz:=(p_payload->>'startsAt')::timestamptz; v_end timestamptz:=(p_payload->>'endsAt')::timestamptz;
  v_day date:=(p_payload->>'competitionStartDate')::date; v_last date:=(p_payload->>'competitionEndDate')::date;
  v_reminder jsonb:=p_payload->'reminder'; v_scheduled timestamptz;
begin
  if nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title')>500 then raise exception 'title_required'; end if;
  if (p_payload->>'competitionLevel') is null or (p_payload->>'competitionLevel') not in ('internal','club','regional','national','international')
    or (p_payload->>'competitionCategory') is null or (p_payload->>'competitionCategory') not in ('u10','u12','u14','u16','u18','all') then raise exception 'invalid_competition'; end if;
  if v_start is null or v_end is null or v_end<=v_start or v_day is null or v_last is null or v_last<v_day
    or extract(year from v_day)<>extract(year from v_last)
    or (v_start at time zone 'Europe/Zurich')::date<>v_day or (v_end at time zone 'Europe/Zurich')::date<>v_last then raise exception 'invalid_competition_dates'; end if;
  if length(coalesce(p_payload->>'locationText',''))>2000 or length(coalesce(p_payload->>'competitionNote',''))>10000
    or length(coalesce(p_payload->>'externalRegistrationUrl',''))>2000
    or (coalesce(btrim(p_payload->>'externalRegistrationUrl'),'')<>'' and p_payload->>'externalRegistrationUrl' !~* '^https?://[^[:space:]/]+') then raise exception 'invalid_competition'; end if;
  if p_reminder_editable and coalesce((v_reminder->>'enabled')::boolean,false) then
    v_scheduled:=(v_reminder->>'scheduledFor')::timestamptz;
    if v_scheduled is null or v_scheduled<=now() or v_scheduled>=v_start
      or v_reminder->>'channel' is null or v_reminder->>'channel' not in ('in_app','email','both')
      or nullif(btrim(v_reminder->>'messageTemplate'),'') is null or length(v_reminder->>'messageTemplate')>10000 then raise exception 'invalid_reminder'; end if;
  end if;
end;
$$;
revoke all on function public.manager_validate_competition_v1(jsonb,boolean) from public,anon,authenticated;

create or replace function public.create_manager_activity_batch_v1(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_request public.manager_activity_creation_requests%rowtype; v_group public.coach_groups%rowtype;
  v_type text:=p_payload->>'eventType'; v_mode text:=p_payload->>'mode'; v_group_mode text:=p_payload->'groupTarget'->>'mode';
  v_player_mode text:=p_payload->'playerTarget'->>'mode'; v_coach_mode text:=p_payload->'coachTarget'->>'mode'; v_parent_mode text:=p_payload->'parentTarget'->>'mode';
  v_groups uuid[]; v_players uuid[]; v_coaches uuid[]; v_parents uuid[]; v_criteria uuid[]; v_clubs uuid[]:='{}';
  v_event_players uuid[]; v_event_coaches uuid[]; v_event_parents uuid[]; v_group_id uuid; v_club uuid; v_id uuid;
  v_template jsonb; v_created jsonb; v_event public.club_events%rowtype; v_events jsonb:='[]'; v_series int:=0;
  v_start timestamptz; v_end timestamptz; v_duration int:=(p_payload->>'durationMinutes')::int;
  v_competition boolean:=v_type='competition'; v_direct boolean; v_reminder jsonb:=p_payload->'reminder';
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'invalid_request'; end if;
  insert into public.manager_activity_creation_requests(actor_id,request_id,payload) values(auth.uid(),p_request_id,p_payload) on conflict do nothing;
  select * into v_request from public.manager_activity_creation_requests where actor_id=auth.uid() and request_id=p_request_id for update;
  if v_request.payload is distinct from p_payload then raise exception 'creation_request_conflict'; end if;
  if v_request.result is not null then
    for v_club in select value::uuid from jsonb_array_elements_text(v_request.result->'club_ids') loop
      perform public.require_manager_club_scope_v1(auth.uid(),v_club);
    end loop;
    return v_request.result||jsonb_build_object('replayed',true);
  end if;
  if v_type is null or v_type not in ('training','interclub','camp','session','event','competition') or v_mode is null or v_mode not in ('single','series')
    or v_group_mode is null or v_group_mode not in ('all','selected')
    or v_player_mode is null or v_player_mode not in ('none','all','selected')
    or v_coach_mode is null or v_coach_mode not in ('none','all','selected')
    or v_parent_mode is null or v_parent_mode not in ('none','all','selected') then raise exception 'invalid_event'; end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into v_players from jsonb_array_elements_text(coalesce(p_payload->'playerTarget'->'ids','[]'));
  select coalesce(array_agg(distinct value::uuid),'{}') into v_coaches from jsonb_array_elements_text(coalesce(p_payload->'coachTarget'->'ids','[]'));
  select coalesce(array_agg(distinct value::uuid),'{}') into v_parents from jsonb_array_elements_text(coalesce(p_payload->'parentTarget'->'ids','[]'));
  select coalesce(array_agg(distinct value::uuid),'{}') into v_criteria from jsonb_array_elements_text(coalesce(p_payload->'evaluationCriterionIds','[]'));
  if cardinality(v_players)>2000 or cardinality(v_coaches)>500 or cardinality(v_parents)>2000 or cardinality(v_criteria)>3 then raise exception 'invalid_assignments'; end if;
  if v_competition then
    if v_mode<>'single' or v_player_mode<>'selected' or cardinality(v_players)=0 or cardinality(v_criteria)>0 then raise exception 'invalid_competition'; end if;
    perform public.manager_validate_competition_v1(p_payload,true);
    v_groups:='{}';
  elsif v_group_mode='all' then
    select coalesce(array_agg(g.id order by g.id),'{}') into v_groups from public.coach_groups g where g.is_active and g.club_season_id is not null
      and g.name is distinct from '__ARCHIVE_HISTORIQUE__' and exists(select 1 from public.club_members m where m.club_id=g.club_id and m.user_id=auth.uid() and m.role='manager' and m.is_active);
  else
    select coalesce(array_agg(distinct value::uuid),'{}') into v_groups from jsonb_array_elements_text(coalesce(p_payload->'groupTarget'->'ids','[]'));
  end if;
  if (v_type='training' or v_mode='series') and (v_duration is null or v_duration not between 1 and 300) then raise exception 'invalid_event'; end if;
  if cardinality(v_groups)>20 then raise exception 'too_many_groups'; end if;
  v_direct:=cardinality(v_groups)=0;
  if v_direct then
    if cardinality(v_players)=0 or (not v_competition and cardinality(v_coaches)=0) then raise exception 'invalid_assignments'; end if;
    select coalesce(array_agg(c.id),'{}') into v_clubs from public.clubs c
      where (not v_competition or c.id=(p_payload->>'competitionClubId')::uuid)
      and exists(select 1 from public.club_members m where m.club_id=c.id and m.user_id=auth.uid() and m.role='manager' and m.is_active)
      and not exists(select 1 from unnest(v_players) u(id) where not exists(select 1 from public.club_members m where m.club_id=c.id and m.user_id=u.id and m.role='player' and m.is_active))
      and not exists(select 1 from unnest(v_coaches) u(id) where not exists(select 1 from public.club_members m where m.club_id=c.id and m.user_id=u.id and m.role='coach' and m.is_active));
    if cardinality(v_clubs)<>1 then raise exception 'invalid_assignments'; end if;
    perform public.require_manager_club_scope_v1(auth.uid(),v_clubs[1]);
    insert into public.coach_groups(club_id,club_season_id,name,is_active,head_coach_user_id)
      values(v_clubs[1],null,case when v_competition then 'Compétition · '||btrim(p_payload->>'title') else 'Groupe spécifique' end,true,v_coaches[1]) returning id into v_group_id;
    insert into public.coach_group_players(group_id,player_user_id) select v_group_id,id from unnest(v_players) u(id);
    insert into public.coach_group_coaches(group_id,coach_user_id,is_head) select v_group_id,id,id=v_coaches[1] from unnest(v_coaches) u(id);
    v_groups:=array[v_group_id];
  end if;
  if exists(select 1 from unnest(v_players) u(id) where not exists(select 1 from public.coach_group_players gp join public.coach_groups g on g.id=gp.group_id join public.club_members m on m.club_id=g.club_id and m.user_id=gp.player_user_id and m.role='player' and m.is_active where gp.group_id=any(v_groups) and gp.player_user_id=u.id))
    or exists(select 1 from unnest(v_coaches) u(id) where not exists(select 1 from public.coach_groups g join public.club_members m on m.club_id=g.club_id and m.user_id=u.id and m.role='coach' and m.is_active where g.id=any(v_groups) and (g.head_coach_user_id=u.id or exists(select 1 from public.coach_group_coaches gc where gc.group_id=g.id and gc.coach_user_id=u.id))))
    or exists(select 1 from unnest(v_parents) u(id) where not exists(select 1 from public.coach_groups g join public.club_members m on m.club_id=g.club_id and m.user_id=u.id and m.role='parent' and m.is_active where g.id=any(v_groups))) then raise exception 'invalid_assignments'; end if;
  foreach v_group_id in array v_groups loop
    select * into v_group from public.coach_groups where id=v_group_id for share;
    if v_group.id is null or not coalesce(v_group.is_active,false) then raise exception 'invalid_assignments'; end if;
    perform public.require_manager_club_scope_v1(auth.uid(),v_group.club_id);
    if not v_direct and (v_group.club_season_id is null or v_group.name='__ARCHIVE_HISTORIQUE__') then raise exception 'invalid_assignments'; end if;
    v_clubs:=array_append(v_clubs,v_group.club_id);
    select coalesce(array_agg(distinct g.player_user_id),'{}') into v_event_players from public.coach_group_players g where g.group_id=v_group_id
      and (v_player_mode='all' or (v_player_mode='selected' and g.player_user_id=any(v_players)));
    select coalesce(array_agg(distinct m.user_id),'{}') into v_event_coaches from public.club_members m where m.club_id=v_group.club_id and m.role='coach' and m.is_active and (
      v_coach_mode='all' or ((v_coach_mode='none' or m.user_id=any(v_coaches)) and (m.user_id=v_group.head_coach_user_id or exists(select 1 from public.coach_group_coaches g where g.group_id=v_group_id and g.coach_user_id=m.user_id))));
    select coalesce(array_agg(distinct m.user_id),'{}') into v_event_parents from public.club_members m where m.club_id=v_group.club_id and m.role='parent' and m.is_active and (
      v_parent_mode='all' or (v_parent_mode='selected' and m.user_id=any(v_parents)) or ((v_parent_mode<>'none' or v_competition) and exists(select 1 from public.player_guardians g where g.guardian_user_id=m.user_id and g.player_id=any(v_event_players) and coalesce(g.can_view,true))));
    if exists(select 1 from unnest(v_event_players) u(id) where not exists(select 1 from public.club_members m where m.club_id=v_group.club_id and m.user_id=u.id and m.role='player' and m.is_active)) then raise exception 'invalid_assignments'; end if;
    if v_mode='single' then
      v_start:=(p_payload->>'startsAt')::timestamptz;
      v_end:=case when v_type='training' then v_start+make_interval(mins=>v_duration) else (p_payload->>'endsAt')::timestamptz end;
      if v_start is null or v_end is null or v_end<=v_start then raise exception 'invalid_event'; end if;
      v_duration:=least(300,round(extract(epoch from(v_end-v_start))/60)::int);
    end if;
    v_template:=jsonb_build_object('event_type',case when v_competition then 'event' else v_type end,'title',p_payload->>'title',
      'starts_at',v_start,'ends_at',v_end,'duration_minutes',v_duration,'location_text',p_payload->>'locationText','coach_note',p_payload->>'coachNote',
      'requires_evaluation',not v_competition and coalesce((p_payload->>'requiresEvaluation')::boolean,false),
      'weekday',p_payload->'series'->'weekday','time_of_day',p_payload->'series'->>'timeOfDay','interval_weeks',p_payload->'series'->'intervalWeeks',
      'start_date',p_payload->'series'->>'startDate','end_date',p_payload->'series'->>'endDate');
    v_created:=public.create_manager_events_v1(gen_random_uuid(),v_group_id,v_mode,v_template,v_event_coaches,
      case when v_competition then v_event_players else v_event_players||v_event_parents end,'[]',v_criteria);
    if v_created->>'series_id' is not null then v_series:=v_series+1; end if;
    for v_id in select value::uuid from jsonb_array_elements_text(v_created->'event_ids') loop
      if v_competition then
        update public.club_events set event_type='competition',requires_evaluation=false,competition_level=p_payload->>'competitionLevel',competition_category=p_payload->>'competitionCategory',
          external_registration_url=nullif(btrim(p_payload->>'externalRegistrationUrl'),''),competition_note=nullif(btrim(p_payload->>'competitionNote'),'') where id=v_id;
        update public.club_event_attendees set status='expected' where event_id=v_id;
        if coalesce((v_reminder->>'enabled')::boolean,false) then
          insert into public.club_event_reminders(event_id,scheduled_for,channel,message_template,status,created_by)
            values(v_id,(v_reminder->>'scheduledFor')::timestamptz,v_reminder->>'channel',btrim(v_reminder->>'messageTemplate'),'pending',auth.uid());
        end if;
      end if;
      select * into v_event from public.club_events where id=v_id;
      v_events:=v_events||jsonb_build_array(jsonb_build_object('id',v_id,'event_type',v_event.event_type,'title',v_event.title,'starts_at',v_event.starts_at,
        'ends_at',v_event.ends_at,'location_text',v_event.location_text,'recipient_ids',to_jsonb(v_event_players||v_event_parents)));
    end loop;
  end loop;
  select array_agg(distinct u.id) into v_clubs from unnest(v_clubs) u(id);
  v_created:=jsonb_build_object('ok',true,'replayed',false,'events',v_events,'createdEvents',jsonb_array_length(v_events),'createdSeries',v_series,'firstEventId',v_events->0->>'id','club_ids',to_jsonb(v_clubs));
  update public.manager_activity_creation_requests set result=v_created where actor_id=auth.uid() and request_id=p_request_id;
  return v_created;
end;
$$;
revoke all on function public.create_manager_activity_batch_v1(uuid,jsonb) from public,anon;
grant execute on function public.create_manager_activity_batch_v1(uuid,jsonb) to authenticated;

create or replace function public.get_manager_competition_snapshot_v1(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.club_events%rowtype;
begin
  select * into v_event from public.club_events where id=p_event_id;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),v_event.club_id);
  if v_event.event_type<>'competition' then raise exception 'invalid_competition'; end if;
  return jsonb_build_object('event',to_jsonb(v_event),
    'attendees',coalesce((select jsonb_agg(to_jsonb(a) order by a.player_id) from public.club_event_attendees a where a.event_id=p_event_id),'[]'),
    'coaches',coalesce((select jsonb_agg(to_jsonb(c) order by c.coach_id) from public.club_event_coaches c where c.event_id=p_event_id),'[]'),
    'reminder',(select to_jsonb(r) from public.club_event_reminders r where r.event_id=p_event_id),
    'group',(select to_jsonb(g) from public.coach_groups g where g.id=v_event.group_id),
    'group_players',coalesce((select jsonb_agg(to_jsonb(p) order by p.player_user_id) from public.coach_group_players p where p.group_id=v_event.group_id),'[]'),
    'group_coaches',coalesce((select jsonb_agg(to_jsonb(c) order by c.coach_user_id) from public.coach_group_coaches c where c.group_id=v_event.group_id),'[]'));
end;
$$;
revoke all on function public.get_manager_competition_snapshot_v1(uuid) from public,anon;
grant execute on function public.get_manager_competition_snapshot_v1(uuid) to authenticated;

create or replace function public.save_manager_competition_v1(p_event_id uuid,p_expected jsonb,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event public.club_events%rowtype; v_group public.coach_groups%rowtype; v_reminder public.club_event_reminders%rowtype;
  v_players uuid[]; v_coaches uuid[]; v_can_change boolean; v_snapshot jsonb; v_start timestamptz; v_end timestamptz;
begin
  select * into v_event from public.club_events where id=p_event_id for update;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  perform public.require_manager_club_scope_v1(auth.uid(),v_event.club_id);
  if v_event.event_type<>'competition' then raise exception 'invalid_competition'; end if;
  if v_event.status='cancelled' then raise exception 'event_cancelled'; end if;
  select * into v_group from public.coach_groups where id=v_event.group_id for update;
  if v_group.id is not null and v_group.club_id is distinct from v_event.club_id then raise exception 'forbidden'; end if;
  perform 1 from public.club_event_attendees where event_id=p_event_id for update;
  perform 1 from public.club_event_coaches where event_id=p_event_id for update;
  perform 1 from public.coach_group_players where group_id=v_event.group_id for update;
  perform 1 from public.coach_group_coaches where group_id=v_event.group_id for update;
  select * into v_reminder from public.club_event_reminders where event_id=p_event_id for update;
  v_snapshot:=public.get_manager_competition_snapshot_v1(p_event_id);
  if p_expected is null or p_expected is distinct from v_snapshot then raise exception 'competition_conflict'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'invalid_competition'; end if;
  v_can_change:=v_reminder.id is null or v_reminder.status='pending';
  perform public.manager_validate_competition_v1(p_payload,v_can_change);
  select coalesce(array_agg(distinct value::uuid),'{}') into v_players from jsonb_array_elements_text(coalesce(p_payload->'playerTarget'->'ids','[]'));
  select coalesce(array_agg(distinct value::uuid),'{}') into v_coaches from jsonb_array_elements_text(coalesce(p_payload->'coachTarget'->'ids','[]'));
  if cardinality(v_players) not between 1 and 2000 or cardinality(v_coaches)>500
    or exists(select 1 from unnest(v_players) u(id) where not exists(select 1 from public.club_members m where m.club_id=v_event.club_id and m.user_id=u.id and m.role='player' and m.is_active))
    or exists(select 1 from unnest(v_coaches) u(id) where not exists(select 1 from public.club_members m where m.club_id=v_event.club_id and m.user_id=u.id and m.role='coach' and m.is_active)) then raise exception 'invalid_assignments'; end if;
  -- A roster edit must not erase recorded participation or evaluation history.
  if exists(select 1 from public.club_event_attendees a where a.event_id=p_event_id and not(a.player_id=any(v_players)) and (
    a.coach_recorded_status is not null or a.status in ('present','absent','excused')
    or exists(select 1 from public.club_event_coach_feedback f where f.event_id=p_event_id and f.player_id=a.player_id)
    or exists(select 1 from public.club_event_player_feedback f where f.event_id=p_event_id and f.player_id=a.player_id)
    or exists(select 1 from public.club_event_evaluation_responses r where r.event_id=p_event_id and r.player_id=a.player_id))) then raise exception 'evaluated_attendee_removal'; end if;
  -- Only an exclusive activity-only group follows this roster. A normal/shared group is preserved.
  if v_group.id is not null and v_group.club_season_id is null and not exists(select 1 from public.club_events e where e.group_id=v_group.id and e.id<>p_event_id) then
    delete from public.coach_group_players where group_id=v_group.id and not(player_user_id=any(v_players));
    insert into public.coach_group_players(group_id,player_user_id) select v_group.id,id from unnest(v_players) u(id) on conflict do nothing;
    delete from public.coach_group_coaches where group_id=v_group.id and not(coach_user_id=any(v_coaches));
    insert into public.coach_group_coaches(group_id,coach_user_id,is_head) select v_group.id,id,id=v_coaches[1] from unnest(v_coaches) u(id)
      on conflict(group_id,coach_user_id) do update set is_head=excluded.is_head;
    update public.coach_groups set name='Compétition · '||btrim(p_payload->>'title'),head_coach_user_id=v_coaches[1] where id=v_group.id;
  end if;
  v_start:=(p_payload->>'startsAt')::timestamptz; v_end:=(p_payload->>'endsAt')::timestamptz;
  update public.club_events set title=btrim(p_payload->>'title'),starts_at=v_start,ends_at=v_end,
    duration_minutes=least(300,greatest(1,round(extract(epoch from(v_end-v_start))/60)::int)),location_text=nullif(btrim(p_payload->>'locationText'),''),
    competition_level=p_payload->>'competitionLevel',competition_category=p_payload->>'competitionCategory',external_registration_url=nullif(btrim(p_payload->>'externalRegistrationUrl'),''),
    competition_note=nullif(btrim(p_payload->>'competitionNote'),''),requires_evaluation=false where id=p_event_id;
  delete from public.club_event_attendees where event_id=p_event_id and not(player_id=any(v_players));
  insert into public.club_event_attendees(event_id,player_id,status) select p_event_id,id,'expected' from unnest(v_players) u(id) on conflict(event_id,player_id) do nothing;
  delete from public.club_event_coaches where event_id=p_event_id and not(coach_id=any(v_coaches));
  insert into public.club_event_coaches(event_id,coach_id) select p_event_id,id from unnest(v_coaches) u(id) on conflict do nothing;
  if v_can_change then
    if coalesce((p_payload->'reminder'->>'enabled')::boolean,false) then
      if v_reminder.id is null then
        insert into public.club_event_reminders(event_id,scheduled_for,channel,message_template,status,created_by)
          values(p_event_id,(p_payload->'reminder'->>'scheduledFor')::timestamptz,p_payload->'reminder'->>'channel',btrim(p_payload->'reminder'->>'messageTemplate'),'pending',auth.uid());
      else
        update public.club_event_reminders set scheduled_for=(p_payload->'reminder'->>'scheduledFor')::timestamptz,channel=p_payload->'reminder'->>'channel',
          message_template=btrim(p_payload->'reminder'->>'messageTemplate'),last_error=null where id=v_reminder.id;
      end if;
    elsif v_reminder.id is not null then delete from public.club_event_reminders where id=v_reminder.id and status='pending'; end if;
  end if;
  return jsonb_build_object('ok',true,'firstEventId',p_event_id);
end;
$$;
revoke all on function public.save_manager_competition_v1(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_manager_competition_v1(uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
