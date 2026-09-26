-- Separate immutable coach source material from coach-reviewed outputs.
-- Existing report_text values (including legacy report_scope = 'mixed') remain untouched.

alter table public.coach_training_debriefs
  add column if not exists collective_summary_text text null,
  add column if not exists individual_comments jsonb not null default '{}'::jsonb;

alter table public.coach_training_debriefs
  drop constraint if exists coach_training_debriefs_collective_summary_length,
  drop constraint if exists coach_training_debriefs_individual_comments_object;

alter table public.coach_training_debriefs
  add constraint coach_training_debriefs_collective_summary_length
    check (char_length(coalesce(collective_summary_text, '')) <= 10000),
  add constraint coach_training_debriefs_individual_comments_object
    check (jsonb_typeof(individual_comments) = 'object');

create or replace function public.save_coach_training_debrief_v2(
  p_event_id uuid,
  p_coach_id uuid,
  p_source_text text,
  p_report_scope text,
  p_collective_summary_text text,
  p_individual_comments jsonb,
  p_reviews jsonb,
  p_update_report boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.club_events%rowtype;
  v_debrief_id uuid;
  v_existing public.coach_training_debriefs%rowtype;
  v_comments jsonb := coalesce(p_individual_comments, '{}'::jsonb);
  v_review jsonb;
  v_player_id uuid;
  v_status text;
  v_engagement integer;
  v_attitude integer;
  v_performance integer;
  v_attendee_count integer;
  v_review_count integer;
  v_unique_review_count integer;
begin
  if not public.can_manage_coach_event(p_event_id, p_coach_id) then
    raise exception 'forbidden';
  end if;

  select * into v_event
  from public.club_events
  where id = p_event_id
  for update;

  if v_event.id is null then raise exception 'event_not_found'; end if;
  if v_event.event_type <> 'training' then raise exception 'training_only'; end if;
  if v_event.status = 'cancelled' then raise exception 'event_cancelled'; end if;
  if p_update_report and not public.is_coach_training_assistance_enabled(v_event.club_id) then
    raise exception 'coach_training_assistance_disabled';
  end if;
  if p_update_report is not true and (
    btrim(coalesce(p_source_text, '')) <> ''
    or btrim(coalesce(p_collective_summary_text, '')) <> ''
    or v_comments <> '{}'::jsonb
  ) then
    raise exception 'report_update_not_allowed';
  end if;
  if coalesce(
    v_event.ends_at,
    v_event.starts_at + make_interval(mins => coalesce(v_event.duration_minutes, 0))
  ) > now() then
    raise exception 'event_not_finished';
  end if;
  if char_length(coalesce(p_source_text, '')) > 10000 then raise exception 'report_too_long'; end if;
  if char_length(coalesce(p_collective_summary_text, '')) > 10000 then
    raise exception 'collective_summary_too_long';
  end if;
  if p_report_scope not in ('collective', 'individual') then raise exception 'invalid_report_scope'; end if;
  if jsonb_typeof(v_comments) <> 'object' then raise exception 'invalid_individual_comments'; end if;
  if exists (
    select 1
    from jsonb_each_text(v_comments) item
    left join public.club_event_attendees attendee
      on attendee.event_id = p_event_id
     and attendee.player_id::text = item.key
    where attendee.player_id is null
       or char_length(btrim(item.value)) > 4000
  ) then
    raise exception 'invalid_individual_comments';
  end if;
  if jsonb_typeof(coalesce(p_reviews, '[]'::jsonb)) <> 'array' then raise exception 'invalid_reviews'; end if;

  select count(*) into v_attendee_count
  from public.club_event_attendees
  where event_id = p_event_id;

  select count(*), count(distinct (value ->> 'player_id'))
  into v_review_count, v_unique_review_count
  from jsonb_array_elements(coalesce(p_reviews, '[]'::jsonb));

  if v_review_count <> v_attendee_count or v_unique_review_count <> v_attendee_count then
    raise exception 'all_attendees_required';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_reviews, '[]'::jsonb)) item
    left join public.club_event_attendees attendee
      on attendee.event_id = p_event_id
     and attendee.player_id::text = item.value ->> 'player_id'
    where attendee.player_id is null
  ) then
    raise exception 'unknown_attendee';
  end if;

  if p_update_report then
    select * into v_existing
    from public.coach_training_debriefs
    where event_id = p_event_id
    for update;

    if v_existing.id is null then
      insert into public.coach_training_debriefs (
        event_id,
        organization_id,
        report_text,
        report_scope,
        collective_summary_text,
        individual_comments,
        author_coach_id
      ) values (
        p_event_id,
        v_event.club_id,
        nullif(btrim(coalesce(p_source_text, '')), ''),
        p_report_scope,
        nullif(btrim(coalesce(p_collective_summary_text, '')), ''),
        v_comments,
        p_coach_id
      )
      returning id into v_debrief_id;
    else
      update public.coach_training_debriefs
      set report_text = nullif(btrim(coalesce(p_source_text, '')), ''),
          report_scope = p_report_scope,
          collective_summary_text = nullif(btrim(coalesce(p_collective_summary_text, '')), ''),
          individual_comments = v_comments,
          report_version = case
            when coalesce(v_existing.report_text, '') is distinct from coalesce(nullif(btrim(coalesce(p_source_text, '')), ''), '')
              or coalesce(v_existing.individual_comments, '{}'::jsonb) is distinct from v_comments
            then v_existing.report_version + 1
            else v_existing.report_version
          end,
          author_coach_id = p_coach_id,
          updated_at = now()
      where id = v_existing.id
      returning id into v_debrief_id;
    end if;
  end if;

  for v_review in
    select value from jsonb_array_elements(coalesce(p_reviews, '[]'::jsonb))
  loop
    v_player_id := (v_review ->> 'player_id')::uuid;
    v_status := v_review ->> 'status';
    v_engagement := nullif(v_review ->> 'engagement', '')::integer;
    v_attitude := nullif(v_review ->> 'attitude', '')::integer;
    v_performance := nullif(v_review ->> 'performance', '')::integer;

    if v_status is null or v_status not in ('present', 'absent') then raise exception 'attendance_required'; end if;
    if v_status = 'present' and (
      v_engagement is null
      or v_attitude is null
      or v_performance is null
      or v_engagement not between 1 and 6
      or v_attitude not between 1 and 6
      or v_performance not between 1 and 6
    ) then
      raise exception 'ratings_required';
    end if;

    update public.club_event_attendees
    set status = v_status,
        coach_recorded_status = v_status,
        coach_recorded_by = p_coach_id,
        coach_recorded_at = now()
    where event_id = p_event_id
      and player_id = v_player_id;

    delete from public.club_event_coach_feedback
    where event_id = p_event_id
      and player_id = v_player_id;

    if v_status = 'present' then
      insert into public.club_event_coach_feedback (
        event_id, player_id, coach_id, engagement, attitude, performance,
        visible_to_player, private_note, player_note
      ) values (
        p_event_id, v_player_id, p_coach_id, v_engagement, v_attitude, v_performance,
        true, null, null
      );
    end if;
  end loop;

  return v_debrief_id;
end;
$$;

revoke all on function public.save_coach_training_debrief_v2(uuid, uuid, text, text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.save_coach_training_debrief_v2(uuid, uuid, text, text, text, jsonb, jsonb, boolean) to service_role;

create or replace function public.validate_coach_training_private_notes(
  p_event_id uuid,
  p_coach_id uuid,
  p_report_version integer,
  p_proposals jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.club_events%rowtype;
  v_debrief public.coach_training_debriefs%rowtype;
  v_item jsonb;
  v_player_id uuid;
  v_body text;
  v_source_text text;
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  if not public.can_manage_coach_event(p_event_id, p_coach_id) then raise exception 'forbidden'; end if;

  select * into v_event from public.club_events where id = p_event_id;
  select * into v_debrief from public.coach_training_debriefs where event_id = p_event_id;

  if v_event.id is null then raise exception 'event_not_found'; end if;
  if v_event.event_type <> 'training' then raise exception 'training_only'; end if;
  if not public.is_coach_training_assistance_enabled(v_event.club_id) then
    raise exception 'coach_training_assistance_disabled';
  end if;
  if v_debrief.id is null then raise exception 'report_required'; end if;
  if p_report_version is null or p_report_version <> v_debrief.report_version then
    raise exception 'stale_report_analysis';
  end if;
  if jsonb_typeof(coalesce(p_proposals, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_proposals, '[]'::jsonb)) > 50 then
    raise exception 'invalid_proposals';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb))
  loop
    v_player_id := (v_item ->> 'player_id')::uuid;
    v_body := btrim(coalesce(v_item ->> 'text', ''));
    v_source_text := case
      when v_debrief.report_scope = 'individual'
        then btrim(coalesce(v_debrief.individual_comments ->> v_player_id::text, ''))
      else btrim(coalesce(v_debrief.report_text, ''))
    end;

    if char_length(v_body) not between 1 and 4000 then raise exception 'invalid_note'; end if;
    if v_source_text = '' then raise exception 'report_required'; end if;
    if not exists (
      select 1
      from public.club_event_attendees attendee
      where attendee.event_id = p_event_id
        and attendee.player_id = v_player_id
        and attendee.coach_recorded_status = 'present'
    ) then
      raise exception 'note_player_must_be_present';
    end if;

    insert into public.coach_player_private_notes (
      event_id, debrief_id, organization_id, player_id, author_coach_id,
      body, source, source_report_version, source_report_text, validated_at
    ) values (
      p_event_id, v_debrief.id, v_event.club_id, v_player_id, p_coach_id,
      v_body, 'ai_suggested', v_debrief.report_version, v_source_text, now()
    )
    on conflict do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.validate_coach_training_private_notes(uuid, uuid, integer, jsonb) from public;
grant execute on function public.validate_coach_training_private_notes(uuid, uuid, integer, jsonb) to service_role;
