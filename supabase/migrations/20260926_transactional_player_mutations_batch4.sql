-- Batch 4: make the Player mutations that span several rows/tables atomic.
-- Server-only functions are granted exclusively to service_role. The golf round
-- creation function is callable by authenticated users and re-checks ownership.

create or replace function public.grant_player_consent_transactional(
  p_player_id uuid,
  p_guardian_user_id uuid,
  p_signer_name text default null,
  p_consent_version text default 'activitee-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_existing_status text;
  v_total_clubs integer := 0;
  v_changed_clubs integer := 0;
  v_decided_at timestamptz;
begin
  if p_player_id is null or p_guardian_user_id is null then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  perform 1
  from public.player_guardians pg
  where pg.player_id = p_player_id
    and pg.guardian_user_id = p_guardian_user_id
    and coalesce(pg.can_view, true) = true
    and coalesce(pg.can_edit, false) = true
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.club_members parent_membership
    where parent_membership.user_id = p_guardian_user_id
      and parent_membership.role = 'parent'
      and parent_membership.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  for v_membership in
    select cm.club_id, cm.player_consent_status
    from public.club_members cm
    where cm.user_id = p_player_id
      and cm.role = 'player'
      and cm.is_active = true
    order by cm.club_id
    for update
  loop
    v_total_clubs := v_total_clubs + 1;
    v_existing_status := null;

    select pc.status
    into v_existing_status
    from public.player_consents pc
    where pc.club_id = v_membership.club_id
      and pc.player_user_id = p_player_id
    for update;

    if v_membership.player_consent_status is distinct from 'granted'
      or v_existing_status is distinct from 'granted'
    then
      v_decided_at := now();

      update public.club_members cm
      set player_consent_status = 'granted'
      where cm.club_id = v_membership.club_id
        and cm.user_id = p_player_id
        and cm.role = 'player'
        and cm.is_active = true;

      insert into public.player_consents (
        club_id,
        player_user_id,
        status,
        decided_at,
        signer_guardian_user_id,
        signer_name,
        source,
        consent_version,
        internal_notes,
        updated_by,
        updated_at
      ) values (
        v_membership.club_id,
        p_player_id,
        'granted',
        v_decided_at,
        p_guardian_user_id,
        nullif(trim(p_signer_name), ''),
        'parent_portal',
        nullif(trim(p_consent_version), ''),
        null,
        p_guardian_user_id,
        v_decided_at
      )
      on conflict (club_id, player_user_id) do update set
        status = excluded.status,
        decided_at = excluded.decided_at,
        signer_guardian_user_id = excluded.signer_guardian_user_id,
        signer_name = excluded.signer_name,
        source = excluded.source,
        consent_version = excluded.consent_version,
        internal_notes = excluded.internal_notes,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

      insert into public.player_consent_history (
        club_id,
        player_user_id,
        status,
        decided_at,
        signer_guardian_user_id,
        signer_name,
        source,
        consent_version,
        changed_by
      ) values (
        v_membership.club_id,
        p_player_id,
        'granted',
        v_decided_at,
        p_guardian_user_id,
        nullif(trim(p_signer_name), ''),
        'parent_portal',
        nullif(trim(p_consent_version), ''),
        p_guardian_user_id
      );

      v_changed_clubs := v_changed_clubs + 1;
    end if;
  end loop;

  if v_total_clubs = 0 then
    raise exception using errcode = 'P0001', message = 'PLAYER_MEMBERSHIP_REQUIRED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'consent_status', 'granted',
    'total_clubs', v_total_clubs,
    'changed_clubs', v_changed_clubs
  );
end;
$$;

revoke all on function public.grant_player_consent_transactional(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.grant_player_consent_transactional(uuid, uuid, text, text) to service_role;

create or replace function public.set_player_camp_registration_transactional(
  p_camp_id uuid,
  p_player_id uuid,
  p_actor_id uuid,
  p_registered boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_camp public.club_camps%rowtype;
  v_registration public.club_camp_players%rowtype;
  v_registered_count integer;
  v_next_status text;
begin
  select c.*
  into v_camp
  from public.club_camps c
  where c.id = p_camp_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CAMP_NOT_FOUND';
  end if;

  if v_camp.status <> 'scheduled' then
    raise exception using errcode = 'P0001', message = 'CAMP_NOT_AVAILABLE';
  end if;

  select cp.*
  into v_registration
  from public.club_camp_players cp
  where cp.camp_id = p_camp_id
    and cp.player_id = p_player_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CAMP_PLAYER_NOT_FOUND';
  end if;

  if p_actor_id is null or (
    p_actor_id <> p_player_id
    and not exists (
      select 1
      from public.player_guardians pg
      where pg.player_id = p_player_id
        and pg.guardian_user_id = p_actor_id
        and coalesce(pg.can_view, true) = true
        and coalesce(pg.can_edit, false) = true
    )
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if p_registered and v_registration.registration_status <> 'registered' then
    select count(*)::integer
    into v_registered_count
    from public.club_camp_players cp
    where cp.camp_id = p_camp_id
      and cp.registration_status = 'registered';

    if v_camp.capacity is not null and v_registered_count >= v_camp.capacity then
      raise exception using errcode = 'P0001', message = 'CAMP_CAPACITY_EXCEEDED';
    end if;
  end if;

  v_next_status := case when p_registered then 'registered' else 'invited' end;

  update public.club_camp_players cp
  set
    registration_status = v_next_status,
    registered_at = case
      when p_registered then coalesce(cp.registered_at, now())
      else null
    end
  where cp.camp_id = p_camp_id
    and cp.player_id = p_player_id;

  insert into public.club_event_attendees (event_id, player_id, status)
  select
    cd.event_id,
    p_player_id,
    case when p_registered then 'present' else 'not_registered' end
  from public.club_camp_days cd
  where cd.camp_id = p_camp_id
  on conflict (event_id, player_id) do update set
    status = excluded.status;

  select count(*)::integer
  into v_registered_count
  from public.club_camp_players cp
  where cp.camp_id = p_camp_id
    and cp.registration_status = 'registered';

  return jsonb_build_object(
    'ok', true,
    'registration_status', v_next_status,
    'registered_count', v_registered_count,
    'capacity', v_camp.capacity
  );
end;
$$;

revoke all on function public.set_player_camp_registration_transactional(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_player_camp_registration_transactional(uuid, uuid, uuid, boolean) to service_role;

create or replace function public.set_player_camp_attendance_transactional(
  p_event_id uuid,
  p_player_id uuid,
  p_actor_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_camp public.club_camps%rowtype;
  v_registration public.club_camp_players%rowtype;
  v_registered_count integer;
begin
  if p_status not in ('present', 'absent') then
    raise exception using errcode = 'P0001', message = 'INVALID_ATTENDANCE_STATUS';
  end if;

  select c.*
  into v_camp
  from public.club_camp_days cd
  join public.club_camps c on c.id = cd.camp_id
  where cd.event_id = p_event_id
  for update of c;
  if not found then
    raise exception using errcode = 'P0001', message = 'CAMP_DAY_NOT_FOUND';
  end if;

  if v_camp.status <> 'scheduled' then
    raise exception using errcode = 'P0001', message = 'CAMP_NOT_AVAILABLE';
  end if;

  select cp.*
  into v_registration
  from public.club_camp_players cp
  where cp.camp_id = v_camp.id
    and cp.player_id = p_player_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CAMP_PLAYER_NOT_FOUND';
  end if;

  if p_actor_id is null or (
    p_actor_id <> p_player_id
    and not exists (
      select 1
      from public.player_guardians pg
      where pg.player_id = p_player_id
        and pg.guardian_user_id = p_actor_id
        and coalesce(pg.can_view, true) = true
        and coalesce(pg.can_edit, false) = true
    )
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if v_registration.registration_status <> 'registered' then
    if p_status <> 'present' then
      raise exception using errcode = 'P0001', message = 'CAMP_REGISTRATION_REQUIRED';
    end if;

    select count(*)::integer
    into v_registered_count
    from public.club_camp_players cp
    where cp.camp_id = v_camp.id
      and cp.registration_status = 'registered';

    if v_camp.capacity is not null and v_registered_count >= v_camp.capacity then
      raise exception using errcode = 'P0001', message = 'CAMP_CAPACITY_EXCEEDED';
    end if;

    update public.club_camp_players cp
    set
      registration_status = 'registered',
      registered_at = coalesce(cp.registered_at, now())
    where cp.camp_id = v_camp.id
      and cp.player_id = p_player_id;
  end if;

  insert into public.club_event_attendees (event_id, player_id, status)
  values (p_event_id, p_player_id, p_status)
  on conflict (event_id, player_id) do update set
    status = excluded.status;

  return jsonb_build_object(
    'ok', true,
    'registration_status', 'registered',
    'attendance_status', p_status
  );
end;
$$;

revoke all on function public.set_player_camp_attendance_transactional(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_player_camp_attendance_transactional(uuid, uuid, uuid, text) to service_role;

create or replace function public.set_player_camp_option_transactional(
  p_camp_id uuid,
  p_option_id uuid,
  p_player_id uuid,
  p_actor_id uuid,
  p_selected boolean,
  p_quantity integer default 1,
  p_selected_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_camp_status text;
  v_option public.club_camp_options%rowtype;
  v_registration public.club_camp_players%rowtype;
  v_choice_values jsonb;
  v_quantity integer;
  v_assigned_by_others integer;
begin
  select camp.status
  into v_camp_status
  from public.club_camps camp
  where camp.id = p_camp_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CAMP_NOT_FOUND';
  end if;

  if v_camp_status <> 'scheduled' then
    raise exception using errcode = 'P0001', message = 'CAMP_NOT_AVAILABLE';
  end if;

  select option_row.*
  into v_option
  from public.club_camp_options option_row
  where option_row.id = p_option_id
    and option_row.camp_id = p_camp_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CAMP_OPTION_NOT_FOUND';
  end if;

  select cp.*
  into v_registration
  from public.club_camp_players cp
  where cp.camp_id = p_camp_id
    and cp.player_id = p_player_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CAMP_PLAYER_NOT_FOUND';
  end if;

  if p_actor_id is null or (
    p_actor_id <> p_player_id
    and not exists (
      select 1
      from public.player_guardians pg
      where pg.player_id = p_player_id
        and pg.guardian_user_id = p_actor_id
        and coalesce(pg.can_view, true) = true
        and coalesce(pg.can_edit, false) = true
    )
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if v_registration.registration_status <> 'registered' then
    raise exception using errcode = 'P0001', message = 'CAMP_REGISTRATION_REQUIRED';
  end if;

  if not p_selected then
    delete from public.club_camp_player_options assignment
    where assignment.option_id = p_option_id
      and assignment.player_id = p_player_id;
    return jsonb_build_object('ok', true, 'selected', false);
  end if;

  if not v_option.is_active then
    raise exception using errcode = 'P0001', message = 'CAMP_OPTION_UNAVAILABLE';
  end if;

  if v_option.input_type = 'checkbox' and jsonb_array_length(v_option.choices) > 0 then
    begin
      v_choice_values := p_selected_value::jsonb;
    exception when others then
      raise exception using errcode = 'P0001', message = 'INVALID_OPTION_VALUE';
    end;

    if jsonb_typeof(v_choice_values) <> 'array'
      or jsonb_array_length(v_choice_values) = 0
      or exists (
        select 1
        from jsonb_array_elements_text(v_choice_values) selected_choice(value)
        where not (v_option.choices ? selected_choice.value)
      )
    then
      raise exception using errcode = 'P0001', message = 'INVALID_OPTION_VALUE';
    end if;
  elsif v_option.input_type = 'yes_no' then
    if coalesce(p_selected_value, '') not in ('yes', 'no') then
      raise exception using errcode = 'P0001', message = 'INVALID_OPTION_VALUE';
    end if;
  elsif v_option.input_type in ('select', 'radio') then
    if coalesce(p_selected_value, '') = '' or not (v_option.choices ? p_selected_value) then
      raise exception using errcode = 'P0001', message = 'INVALID_OPTION_VALUE';
    end if;
  end if;

  v_quantity := case
    when v_option.input_type = 'checkbox'
      and jsonb_array_length(v_option.choices) = 0
      and v_option.allows_quantity
    then p_quantity
    else 1
  end;

  if v_quantity is null or v_quantity < 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_OPTION_QUANTITY';
  end if;

  select coalesce(sum(assignment.quantity), 0)::integer
  into v_assigned_by_others
  from public.club_camp_player_options assignment
  where assignment.option_id = p_option_id
    and assignment.player_id <> p_player_id;

  if v_option.capacity is not null and v_assigned_by_others + v_quantity > v_option.capacity then
    raise exception using errcode = 'P0001', message = 'CAMP_OPTION_CAPACITY_EXCEEDED';
  end if;

  insert into public.club_camp_player_options (
    option_id,
    player_id,
    quantity,
    selected_value,
    assigned_by,
    updated_at
  ) values (
    p_option_id,
    p_player_id,
    v_quantity,
    case
      when v_option.input_type = 'checkbox' and jsonb_array_length(v_option.choices) = 0 then null
      else p_selected_value
    end,
    p_actor_id,
    now()
  )
  on conflict (option_id, player_id) do update set
    quantity = excluded.quantity,
    selected_value = excluded.selected_value,
    assigned_by = excluded.assigned_by,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'selected', true,
    'quantity', v_quantity,
    'remaining_capacity', case
      when v_option.capacity is null then null
      else greatest(v_option.capacity - v_assigned_by_others - v_quantity, 0)
    end
  );
end;
$$;

revoke all on function public.set_player_camp_option_transactional(uuid, uuid, uuid, uuid, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.set_player_camp_option_transactional(uuid, uuid, uuid, uuid, boolean, integer, text) to service_role;

create or replace function public.create_player_golf_rounds_transactional(
  p_player_id uuid,
  p_round_payload jsonb,
  p_round_dates timestamptz[],
  p_holes jsonb default '[]'::jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.golf_rounds%rowtype;
  v_hole public.golf_round_holes%rowtype;
  v_hole_payload jsonb;
  v_round_id uuid;
  v_round_date timestamptz;
  v_round_ids uuid[] := array[]::uuid[];
begin
  if p_player_id is null or p_round_payload is null or jsonb_typeof(p_round_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
  end if;

  if v_actor_id is null or (
    v_actor_id <> p_player_id
    and not exists (
      select 1
      from public.player_guardians pg
      where pg.player_id = p_player_id
        and pg.guardian_user_id = v_actor_id
        and coalesce(pg.can_view, true) = true
        and coalesce(pg.can_edit, false) = true
    )
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.club_members cm
    where cm.user_id = p_player_id
      and cm.role = 'player'
      and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_MEMBERSHIP_REQUIRED';
  end if;

  if p_round_dates is null
    or coalesce(array_length(p_round_dates, 1), 0) not between 1 and 4
    or array_position(p_round_dates, null) is not null
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_DATES';
  end if;

  if p_holes is null or jsonb_typeof(p_holes) <> 'array' or jsonb_array_length(p_holes) > 18 then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLES_PAYLOAD';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_holes) hole
    where jsonb_typeof(hole.value) <> 'object'
      or nullif(hole.value ->> 'hole_no', '') is null
      or (hole.value ->> 'hole_no')::integer not between 1 and 18
  ) or (
    select count(*)
    from (
      select hole.value ->> 'hole_no'
      from jsonb_array_elements(p_holes) hole
      group by hole.value ->> 'hole_no'
      having count(*) > 1
    ) duplicates
  ) > 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLES_PAYLOAD';
  end if;

  v_round := jsonb_populate_record(null::public.golf_rounds, p_round_payload);

  if coalesce(trim(v_round.round_type::text), '') not in ('training', 'competition')
    or (
      v_round.round_type = 'competition'
      and v_round.om_competition_format = 'stroke_play_individual'
      and v_round.om_rounds_18_count is distinct from array_length(p_round_dates, 1)
    )
    or (
      coalesce(array_length(p_round_dates, 1), 0) > 1
      and not (
        v_round.round_type = 'competition'
        and v_round.om_competition_format = 'stroke_play_individual'
      )
    )
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
  end if;

  if v_round.om_organization_id is not null and not exists (
    select 1
    from public.club_members cm
    where cm.user_id = p_player_id
      and cm.club_id = v_round.om_organization_id
      and cm.role = 'player'
      and cm.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  foreach v_round_date in array p_round_dates
  loop
    insert into public.golf_rounds (
      user_id,
      location,
      round_type,
      competition_name,
      handicap_start,
      course_source,
      course_name,
      external_course_id,
      tee_name,
      slope_rating,
      course_rating,
      match_opponent_handicap,
      om_match_result,
      match_score_text,
      notes,
      om_organization_id,
      om_competition_level,
      om_competition_format,
      om_rounds_18_count,
      score_entry_mode,
      om_match_play_wins,
      om_is_exceptional,
      om_exceptional_tournament_id,
      om_stats_submitted_at,
      start_at
    ) values (
      p_player_id,
      v_round.location,
      v_round.round_type,
      v_round.competition_name,
      v_round.handicap_start,
      v_round.course_source,
      v_round.course_name,
      v_round.external_course_id,
      v_round.tee_name,
      v_round.slope_rating,
      v_round.course_rating,
      v_round.match_opponent_handicap,
      v_round.om_match_result,
      v_round.match_score_text,
      v_round.notes,
      v_round.om_organization_id,
      v_round.om_competition_level,
      v_round.om_competition_format,
      v_round.om_rounds_18_count,
      v_round.score_entry_mode,
      v_round.om_match_play_wins,
      v_round.om_is_exceptional,
      v_round.om_exceptional_tournament_id,
      v_round.om_stats_submitted_at,
      v_round_date
    )
    returning id into v_round_id;

    for v_hole_payload in
      select value from jsonb_array_elements(p_holes)
    loop
      v_hole := jsonb_populate_record(null::public.golf_round_holes, v_hole_payload);
      insert into public.golf_round_holes (round_id, hole_no, par, stroke_index)
      values (v_round_id, v_hole.hole_no, v_hole.par, v_hole.stroke_index);
    end loop;

    v_round_ids := array_append(v_round_ids, v_round_id);
  end loop;

  return v_round_ids;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'INVALID_ROUND_PAYLOAD';
end;
$$;

revoke all on function public.create_player_golf_rounds_transactional(uuid, jsonb, timestamptz[], jsonb) from public, anon;
grant execute on function public.create_player_golf_rounds_transactional(uuid, jsonb, timestamptz[], jsonb) to authenticated;
