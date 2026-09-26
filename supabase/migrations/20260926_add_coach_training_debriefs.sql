-- Coach post-training debriefs, explicit attendance reviews and validated private notes.
-- This migration is intentionally additive: legacy attendance status remains available,
-- while coach_recorded_status is nullable and never preselected.

alter table if exists public.training_volume_settings
  add column if not exists coach_training_assistance_enabled boolean not null default false;

create or replace function public.is_coach_training_assistance_enabled(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select s.coach_training_assistance_enabled
    from public.training_volume_settings s
    where s.organization_id = p_organization_id
  ), false);
$$;

revoke all on function public.is_coach_training_assistance_enabled(uuid) from public;
grant execute on function public.is_coach_training_assistance_enabled(uuid) to authenticated, service_role;

alter table if exists public.club_event_attendees
  add column if not exists coach_recorded_status text null,
  add column if not exists coach_recorded_by uuid null references public.profiles(id) on delete set null,
  add column if not exists coach_recorded_at timestamptz null;

alter table if exists public.club_event_attendees
  drop constraint if exists club_event_attendees_coach_recorded_status_check;

alter table if exists public.club_event_attendees
  add constraint club_event_attendees_coach_recorded_status_check
  check (coach_recorded_status is null or coach_recorded_status in ('present', 'absent'));

create table if not exists public.coach_training_debriefs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.club_events(id) on delete cascade,
  organization_id uuid not null references public.clubs(id) on delete cascade,
  report_text text null,
  report_scope text not null default 'mixed',
  report_version integer not null default 1 check (report_version > 0),
  author_coach_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_training_debriefs_report_length
    check (char_length(coalesce(report_text, '')) <= 10000),
  constraint coach_training_debriefs_report_scope_check
    check (report_scope in ('collective', 'individual', 'mixed'))
);

create table if not exists public.coach_player_private_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  debrief_id uuid not null references public.coach_training_debriefs(id) on delete cascade,
  organization_id uuid not null references public.clubs(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  author_coach_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  source text not null default 'ai_suggested',
  source_report_version integer not null check (source_report_version > 0),
  source_report_text text not null,
  validated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint coach_player_private_notes_body_length
    check (char_length(btrim(body)) between 1 and 4000),
  constraint coach_player_private_notes_source_check
    check (source in ('ai_suggested', 'coach_manual'))
);

create index if not exists idx_coach_training_debriefs_event
  on public.coach_training_debriefs (event_id);

create index if not exists idx_coach_player_private_notes_player_created
  on public.coach_player_private_notes (player_id, created_at desc);

create index if not exists idx_coach_player_private_notes_event
  on public.coach_player_private_notes (event_id, created_at desc);

create unique index if not exists idx_coach_player_private_notes_idempotent
  on public.coach_player_private_notes (
    debrief_id,
    player_id,
    author_coach_id,
    source_report_version,
    md5(body)
  );

create or replace function public.can_manage_coach_event(
  p_event_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_events e
    where e.id = p_event_id
      and (
        exists (
          select 1
          from public.club_members cm
          where cm.club_id = e.club_id
            and cm.user_id = case when auth.role() = 'service_role' then p_user_id else auth.uid() end
            and cm.is_active = true
            and cm.role in ('coach', 'manager')
        )
        or exists (
          select 1
          from public.coach_groups g
          where g.id = e.group_id
            and g.head_coach_user_id = case when auth.role() = 'service_role' then p_user_id else auth.uid() end
        )
        or exists (
          select 1
          from public.coach_group_coaches gc
          where gc.group_id = e.group_id
            and gc.coach_user_id = case when auth.role() = 'service_role' then p_user_id else auth.uid() end
        )
        or exists (
          select 1
          from public.club_event_coaches ec
          where ec.event_id = e.id
            and ec.coach_id = case when auth.role() = 'service_role' then p_user_id else auth.uid() end
        )
      )
  );
$$;

revoke all on function public.can_manage_coach_event(uuid, uuid) from public;
grant execute on function public.can_manage_coach_event(uuid, uuid) to authenticated, service_role;

alter table public.coach_training_debriefs enable row level security;
alter table public.coach_player_private_notes enable row level security;

drop policy if exists "coach_training_debriefs_staff_select" on public.coach_training_debriefs;
create policy "coach_training_debriefs_staff_select"
on public.coach_training_debriefs
for select
to authenticated
using (public.can_manage_coach_event(event_id, auth.uid()));

drop policy if exists "coach_training_debriefs_staff_insert" on public.coach_training_debriefs;
create policy "coach_training_debriefs_staff_insert"
on public.coach_training_debriefs
for insert
to authenticated
with check (
  author_coach_id = auth.uid()
  and public.can_manage_coach_event(event_id, auth.uid())
);

drop policy if exists "coach_training_debriefs_staff_update" on public.coach_training_debriefs;
create policy "coach_training_debriefs_staff_update"
on public.coach_training_debriefs
for update
to authenticated
using (public.can_manage_coach_event(event_id, auth.uid()))
with check (public.can_manage_coach_event(event_id, auth.uid()));

drop policy if exists "coach_player_private_notes_staff_select" on public.coach_player_private_notes;
create policy "coach_player_private_notes_staff_select"
on public.coach_player_private_notes
for select
to authenticated
using (public.can_manage_coach_event(event_id, auth.uid()));

-- Private notes are created only by the validated server workflow below. No
-- player or guardian policy is intentionally defined on this table.

create or replace function public.save_coach_training_debrief(
  p_event_id uuid,
  p_coach_id uuid,
  p_report_text text,
  p_report_scope text,
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

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if v_event.event_type <> 'training' then
    raise exception 'training_only';
  end if;
  if v_event.status = 'cancelled' then
    raise exception 'event_cancelled';
  end if;
  if p_update_report and not public.is_coach_training_assistance_enabled(v_event.club_id) then
    raise exception 'coach_training_assistance_disabled';
  end if;
  if p_update_report is not true and btrim(coalesce(p_report_text, '')) <> '' then
    raise exception 'report_update_not_allowed';
  end if;
  if coalesce(
    v_event.ends_at,
    v_event.starts_at + make_interval(mins => coalesce(v_event.duration_minutes, 0))
  ) > now() then
    raise exception 'event_not_finished';
  end if;
  if char_length(coalesce(p_report_text, '')) > 10000 then
    raise exception 'report_too_long';
  end if;
  if p_report_scope not in ('collective', 'individual', 'mixed') then
    raise exception 'invalid_report_scope';
  end if;
  if jsonb_typeof(coalesce(p_reviews, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_reviews';
  end if;

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
    left join public.club_event_attendees a
      on a.event_id = p_event_id
     and a.player_id::text = item.value ->> 'player_id'
    where a.player_id is null
  ) then
    raise exception 'unknown_attendee';
  end if;

  if p_update_report then
    select id into v_debrief_id
    from public.coach_training_debriefs
    where event_id = p_event_id
    for update;

    if v_debrief_id is null then
      insert into public.coach_training_debriefs (
        event_id, organization_id, report_text, report_scope, author_coach_id
      ) values (
        p_event_id,
        v_event.club_id,
        nullif(btrim(coalesce(p_report_text, '')), ''),
        p_report_scope,
        p_coach_id
      )
      returning id into v_debrief_id;
    else
      update public.coach_training_debriefs
      set report_text = nullif(btrim(coalesce(p_report_text, '')), ''),
          report_scope = p_report_scope,
          report_version = case
            when coalesce(report_text, '') is distinct from coalesce(nullif(btrim(coalesce(p_report_text, '')), ''), '')
              then report_version + 1
            else report_version
          end,
          author_coach_id = p_coach_id,
          updated_at = now()
      where id = v_debrief_id;
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

    if v_status is null or v_status not in ('present', 'absent') then
      raise exception 'attendance_required';
    end if;
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
        event_id,
        player_id,
        coach_id,
        engagement,
        attitude,
        performance,
        visible_to_player,
        private_note,
        player_note
      ) values (
        p_event_id,
        v_player_id,
        p_coach_id,
        v_engagement,
        v_attitude,
        v_performance,
        true,
        null,
        null
      );
    end if;
  end loop;

  return v_debrief_id;
end;
$$;

revoke all on function public.save_coach_training_debrief(uuid, uuid, text, text, jsonb, boolean) from public;
grant execute on function public.save_coach_training_debrief(uuid, uuid, text, text, jsonb, boolean) to service_role;

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
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  if not public.can_manage_coach_event(p_event_id, p_coach_id) then
    raise exception 'forbidden';
  end if;

  select * into v_event from public.club_events where id = p_event_id;
  select * into v_debrief from public.coach_training_debriefs where event_id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if v_event.event_type <> 'training' then
    raise exception 'training_only';
  end if;
  if not public.is_coach_training_assistance_enabled(v_event.club_id) then
    raise exception 'coach_training_assistance_disabled';
  end if;
  if v_debrief.id is null or btrim(coalesce(v_debrief.report_text, '')) = '' then
    raise exception 'report_required';
  end if;
  if p_report_version is null or p_report_version <> v_debrief.report_version then
    raise exception 'stale_report_analysis';
  end if;
  if jsonb_typeof(coalesce(p_proposals, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_proposals, '[]'::jsonb)) > 50 then
    raise exception 'invalid_proposals';
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb))
  loop
    v_player_id := (v_item ->> 'player_id')::uuid;
    v_body := btrim(coalesce(v_item ->> 'text', ''));

    if char_length(v_body) not between 1 and 4000 then
      raise exception 'invalid_note';
    end if;
    if not exists (
      select 1
      from public.club_event_attendees a
      where a.event_id = p_event_id
        and a.player_id = v_player_id
        and a.coach_recorded_status = 'present'
    ) then
      raise exception 'note_player_must_be_present';
    end if;

    insert into public.coach_player_private_notes (
      event_id,
      debrief_id,
      organization_id,
      player_id,
      author_coach_id,
      body,
      source,
      source_report_version,
      source_report_text,
      validated_at
    ) values (
      p_event_id,
      v_debrief.id,
      v_event.club_id,
      v_player_id,
      p_coach_id,
      v_body,
      'ai_suggested',
      v_debrief.report_version,
      v_debrief.report_text,
      now()
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
