-- Remove the obsolete report dependency from the guided per-player evaluation save.

create or replace function public.save_coach_training_player_evaluation_v1(
  p_event_id uuid,
  p_coach_id uuid,
  p_player_id uuid,
  p_status text,
  p_engagement integer,
  p_attitude integer,
  p_performance integer,
  p_source_text text,
  p_private_note text,
  p_update_comment boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.club_events%rowtype;
  v_attendee public.club_event_attendees%rowtype;
  v_debrief public.coach_training_debriefs%rowtype;
  v_debrief_id uuid;
  v_comments jsonb;
  v_source_text text := btrim(coalesce(p_source_text, ''));
  v_private_note text := btrim(coalesce(p_private_note, ''));
  v_report_version integer;
begin
  if not public.can_manage_coach_event(p_event_id, p_coach_id) then raise exception 'forbidden'; end if;

  select * into v_event
  from public.club_events
  where id = p_event_id
  for update;

  if v_event.id is null then raise exception 'event_not_found'; end if;
  if v_event.event_type <> 'training' then raise exception 'training_only'; end if;
  if v_event.status = 'cancelled' then raise exception 'event_cancelled'; end if;
  if coalesce(
    v_event.ends_at,
    v_event.starts_at + make_interval(mins => coalesce(v_event.duration_minutes, 0))
  ) > now() then raise exception 'event_not_finished'; end if;

  select * into v_attendee
  from public.club_event_attendees
  where event_id = p_event_id
    and player_id = p_player_id
  for update;

  if v_attendee.player_id is null then raise exception 'unknown_attendee'; end if;
  if p_status is null or p_status not in ('present', 'absent') then raise exception 'attendance_required'; end if;
  if p_status = 'present' and (
    p_engagement is null or p_engagement not between 1 and 6
    or p_attitude is null or p_attitude not between 1 and 6
    or p_performance is null or p_performance not between 1 and 6
  ) then raise exception 'ratings_required'; end if;
  if char_length(v_source_text) > 4000 then raise exception 'individual_comment_too_long'; end if;
  if char_length(v_private_note) > 4000 then raise exception 'invalid_note'; end if;
  if p_status = 'absent' and (v_source_text <> '' or v_private_note <> '') then
    raise exception 'absent_comment_not_allowed';
  end if;

  update public.club_event_attendees
  set status = p_status,
      coach_recorded_status = p_status,
      coach_recorded_by = p_coach_id,
      coach_recorded_at = now()
  where event_id = p_event_id
    and player_id = p_player_id;

  delete from public.club_event_coach_feedback
  where event_id = p_event_id
    and player_id = p_player_id;

  if p_status = 'present' then
    insert into public.club_event_coach_feedback (
      event_id, player_id, coach_id, engagement, attitude, performance,
      visible_to_player, private_note, player_note
    ) values (
      p_event_id, p_player_id, p_coach_id, p_engagement, p_attitude, p_performance,
      true, nullif(v_private_note, ''), nullif(v_source_text, '')
    );

    select * into v_debrief
    from public.coach_training_debriefs
    where event_id = p_event_id
    for update;

    if v_debrief.id is null and v_source_text <> '' then
      v_comments := jsonb_build_object(p_player_id::text, v_source_text);
      insert into public.coach_training_debriefs (
        event_id, organization_id, report_text, report_scope,
        collective_summary_text, individual_comments, report_version, author_coach_id
      ) values (
        p_event_id, v_event.club_id, null, 'individual',
        null, v_comments, 1, p_coach_id
      )
      returning id, report_version into v_debrief_id, v_report_version;
    elsif v_debrief.id is not null then
      v_comments := coalesce(v_debrief.individual_comments, '{}'::jsonb);
      v_comments := case
        when v_source_text = '' then v_comments - p_player_id::text
        else jsonb_set(v_comments, array[p_player_id::text], to_jsonb(v_source_text), true)
      end;

      update public.coach_training_debriefs
      set individual_comments = v_comments,
          report_version = case
            when coalesce(v_debrief.individual_comments, '{}'::jsonb) is distinct from v_comments
              then v_debrief.report_version + 1
            else v_debrief.report_version
          end,
          author_coach_id = p_coach_id,
          updated_at = now()
      where id = v_debrief.id
      returning id, report_version into v_debrief_id, v_report_version;
    end if;
  end if;

  return jsonb_build_object(
    'debrief_id', v_debrief_id,
    'report_version', v_report_version,
    'note_inserted', false
  );
end;
$$;

revoke all on function public.save_coach_training_player_evaluation_v1(
  uuid, uuid, uuid, text, integer, integer, integer, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.save_coach_training_player_evaluation_v1(
  uuid, uuid, uuid, text, integer, integer, integer, text, text, boolean
) to service_role;
