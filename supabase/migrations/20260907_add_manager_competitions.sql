-- Manager-created club competitions and their scheduled reminders.
-- Competitions stay in the existing club_events / club_event_attendees model.

alter table if exists public.club_events
  drop constraint if exists club_events_event_type_check;

alter table if exists public.club_events
  add constraint club_events_event_type_check
  check (event_type in ('training', 'interclub', 'camp', 'session', 'event', 'competition'));

alter table if exists public.club_event_series
  drop constraint if exists club_event_series_event_type_check;

alter table if exists public.club_event_series
  add constraint club_event_series_event_type_check
  check (event_type in ('training', 'interclub', 'camp', 'session', 'event', 'competition'));

alter table if exists public.club_events
  add column if not exists competition_level text,
  add column if not exists competition_category text,
  add column if not exists external_registration_url text,
  add column if not exists competition_note text;

alter table if exists public.club_events
  drop constraint if exists club_events_competition_level_check,
  drop constraint if exists club_events_competition_category_check,
  drop constraint if exists club_events_competition_url_check,
  drop constraint if exists club_events_competition_fields_check;

alter table if exists public.club_events
  add constraint club_events_competition_level_check
    check (competition_level is null or competition_level in ('internal', 'club', 'regional', 'national', 'international')),
  add constraint club_events_competition_category_check
    check (competition_category is null or competition_category in ('u10', 'u12', 'u14', 'u16', 'u18', 'all')),
  add constraint club_events_competition_url_check
    check (external_registration_url is null or external_registration_url ~* '^https?://'),
  add constraint club_events_competition_fields_check
    check (
      event_type <> 'competition'
      or (
        nullif(btrim(title), '') is not null
        and ends_at is not null
        and ends_at >= starts_at
        and competition_level is not null
        and competition_category is not null
        and extract(year from starts_at at time zone 'Europe/Zurich') = extract(year from ends_at at time zone 'Europe/Zurich')
      )
    );

create index if not exists club_events_competition_schedule_idx
  on public.club_events (club_id, starts_at)
  where event_type = 'competition';

-- Existing club_events policies intentionally allow coaches to manage classic
-- group activities. A restrictive trigger keeps competitions manager-only,
-- including direct Supabase writes that do not pass through the manager API.
create or replace function public.ensure_manager_controls_competitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_club_id uuid;
begin
  if tg_op = 'DELETE' then
    v_event_type := old.event_type;
    v_club_id := old.club_id;
  else
    v_event_type := new.event_type;
    v_club_id := new.club_id;
    if tg_op = 'UPDATE' and old.event_type = 'competition' then
      v_event_type := 'competition';
      v_club_id := old.club_id;
    end if;
  end if;

  if v_event_type = 'competition' and coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null or not exists (
      select 1
      from public.club_members cm
      where cm.club_id = v_club_id
        and cm.user_id = auth.uid()
        and cm.role = 'manager'
        and cm.is_active = true
    ) then
      raise exception 'Only an active club manager can create, update or delete a competition'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_manager_only_club_competitions on public.club_events;
create trigger trg_manager_only_club_competitions
before insert or update or delete on public.club_events
for each row execute function public.ensure_manager_controls_competitions();

create table if not exists public.club_event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  scheduled_for timestamptz not null,
  channel text not null check (channel in ('in_app', 'email', 'both')),
  message_template text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id)
);

create index if not exists club_event_reminders_due_idx
  on public.club_event_reminders (scheduled_for, id)
  where status = 'pending' and sent_at is null;

create index if not exists club_event_reminders_event_idx
  on public.club_event_reminders (event_id);

alter table if exists public.club_event_reminders enable row level security;

drop policy if exists "managers_can_select_club_event_reminders" on public.club_event_reminders;
create policy "managers_can_select_club_event_reminders"
on public.club_event_reminders
for select
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id
    where e.id = club_event_reminders.event_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
);

drop policy if exists "managers_can_insert_club_event_reminders" on public.club_event_reminders;
create policy "managers_can_insert_club_event_reminders"
on public.club_event_reminders
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id
    where e.id = club_event_reminders.event_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
);

drop policy if exists "managers_can_update_club_event_reminders" on public.club_event_reminders;
create policy "managers_can_update_club_event_reminders"
on public.club_event_reminders
for update
to authenticated
using (
  status = 'pending'
  and exists (
    select 1
    from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id
    where e.id = club_event_reminders.event_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
)
with check (
  status in ('pending', 'cancelled')
  and exists (
    select 1
    from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id
    where e.id = club_event_reminders.event_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
);

drop policy if exists "managers_can_delete_pending_club_event_reminders" on public.club_event_reminders;
create policy "managers_can_delete_pending_club_event_reminders"
on public.club_event_reminders
for delete
to authenticated
using (
  status = 'pending'
  and exists (
    select 1
    from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id
    where e.id = club_event_reminders.event_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
);

create or replace function public.touch_club_event_reminder_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_club_event_reminder_updated_at on public.club_event_reminders;
create trigger trg_touch_club_event_reminder_updated_at
before update on public.club_event_reminders
for each row execute function public.touch_club_event_reminder_updated_at();

create or replace function public.cancel_club_event_reminders()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    update public.club_event_reminders
    set status = 'cancelled', last_error = null
    where event_id = new.id
      and status in ('pending', 'processing');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cancel_club_event_reminders on public.club_events;
create trigger trg_cancel_club_event_reminders
after update of status on public.club_events
for each row execute function public.cancel_club_event_reminders();

create or replace function public.claim_due_club_event_reminders(p_limit integer default 50)
returns setof public.club_event_reminders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select r.id
    from public.club_event_reminders r
    join public.club_events e on e.id = r.event_id
    where r.status = 'pending'
      and r.sent_at is null
      and r.scheduled_for <= now()
      and e.status = 'scheduled'
    order by r.scheduled_for, r.id
    for update of r skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  update public.club_event_reminders r
  set status = 'processing', attempt_count = r.attempt_count + 1, updated_at = now()
  from due
  where r.id = due.id
  returning r.*;
end;
$$;

revoke all on function public.claim_due_club_event_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_club_event_reminders(integer) to service_role;

-- Attendees of a competition are an audience, not registrations/presence records.
create or replace function public.normalize_club_event_attendee_initial_status()
returns trigger
language plpgsql
as $$
declare
  v_event_type text;
begin
  select e.event_type into v_event_type
  from public.club_events e
  where e.id = new.event_id;

  if coalesce(v_event_type, '') = 'camp' then
    if new.status is null or new.status = 'expected' then
      new.status := 'not_registered';
    end if;
  elsif coalesce(v_event_type, '') = 'competition' then
    new.status := 'expected';
  elsif new.status is null or new.status = 'expected' then
    new.status := 'present';
  end if;

  return new;
end;
$$;

-- Competition attendee rows are immutable audience links. They must never be
-- converted into attendance or registration records by a generic endpoint.
create or replace function public.enforce_competition_attendee_audience_status()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.club_events e
    where e.id = new.event_id
      and e.event_type = 'competition'
  ) then
    new.status := 'expected';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_competition_attendee_audience_status on public.club_event_attendees;
create trigger trg_enforce_competition_attendee_audience_status
before insert or update on public.club_event_attendees
for each row execute function public.enforce_competition_attendee_audience_status();
