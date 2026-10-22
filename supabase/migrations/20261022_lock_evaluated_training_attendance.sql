-- Preserve a player's saved self-evaluation when staff revisit a training.
-- Both writers serialize on the attendee row so a stale page cannot race the lock.
begin;

create or replace function public.training_player_has_evaluation(p_event_id uuid, p_player_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.training_sessions s
    where s.club_event_id = p_event_id and s.user_id = p_player_id
      and (s.motivation is not null or s.difficulty is not null or s.satisfaction is not null))
    or exists (select 1 from public.club_event_player_feedback f
      where f.event_id = p_event_id and f.player_id = p_player_id
        and (f.motivation is not null or f.difficulty is not null or f.satisfaction is not null))
    or exists (select 1 from public.club_event_evaluation_responses r
      where r.event_id = p_event_id and r.player_id = p_player_id and r.respondent_role = 'player'
        and r.value_json is not null and r.value_json not in ('null'::jsonb, '""'::jsonb));
$$;
revoke all on function public.training_player_has_evaluation(uuid, uuid) from public, anon, authenticated;

create or replace function public.lock_evaluated_training_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if new.status is not distinct from old.status
    and new.coach_recorded_status is not distinct from old.coach_recorded_status then return new; end if;
  if not exists (select 1 from public.club_events where id = old.event_id and event_type = 'training') then return new; end if;
  if not public.training_player_has_evaluation(old.event_id, old.player_id) then return new; end if;
  v_status := case when coalesce(old.coach_recorded_status, old.status) in ('absent', 'excused') then 'absent' else 'present' end;
  -- Confirming an expected player as present remains possible; changing attendance does not.
  if (new.status is distinct from old.status and new.status is distinct from v_status)
    or (new.coach_recorded_status is distinct from old.coach_recorded_status and new.coach_recorded_status is distinct from v_status) then
    raise exception 'attendance_locked_by_player_evaluation';
  end if;
  return new;
end;
$$;
revoke all on function public.lock_evaluated_training_attendance() from public, anon, authenticated;
create or replace trigger lock_evaluated_training_attendance
before update of status, coach_recorded_status on public.club_event_attendees
for each row execute function public.lock_evaluated_training_attendance();

create or replace function public.guard_training_player_evaluation_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_event_id uuid; v_player_id uuid; v_status text;
begin
  if tg_table_name = 'training_sessions' then
    if new.motivation is null and new.difficulty is null and new.satisfaction is null then return new; end if;
    v_event_id := new.club_event_id; v_player_id := new.user_id;
  elsif tg_table_name = 'club_event_player_feedback' then
    if new.motivation is null and new.difficulty is null and new.satisfaction is null then return new; end if;
    v_event_id := new.event_id; v_player_id := new.player_id;
  else
    if new.respondent_role <> 'player' or new.value_json is null or new.value_json in ('null'::jsonb, '""'::jsonb) then return new; end if;
    v_event_id := new.event_id; v_player_id := new.player_id;
  end if;
  if v_event_id is null or not exists (select 1 from public.club_events where id = v_event_id and event_type = 'training') then return new; end if;
  select coalesce(a.coach_recorded_status, a.status) into v_status from public.club_event_attendees a
    where a.event_id = v_event_id and a.player_id = v_player_id for update;
  if v_status in ('absent', 'excused', 'not_registered') then
    raise exception 'player_evaluation_attendance_absent';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_training_player_evaluation_attendance() from public, anon, authenticated;
create or replace trigger guard_training_session_evaluation_attendance
before insert or update on public.training_sessions
for each row execute function public.guard_training_player_evaluation_attendance();
create or replace trigger guard_training_feedback_evaluation_attendance
before insert or update on public.club_event_player_feedback
for each row execute function public.guard_training_player_evaluation_attendance();
create or replace trigger guard_training_response_evaluation_attendance
before insert or update on public.club_event_evaluation_responses
for each row execute function public.guard_training_player_evaluation_attendance();

commit;
