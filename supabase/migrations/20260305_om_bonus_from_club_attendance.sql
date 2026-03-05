-- OM bonus automation from club attendance.
-- - training_presence: +5 (net/brut) for club training attendance
-- - camp_day_presence: +15 (net/brut) for club camp attendance
-- Only counted when event date is in the past (Europe/Zurich) and attendee status is present.

create or replace function public.om_sync_bonus_for_attendee(
  p_event_id uuid,
  p_player_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_bonus_type text;
  v_points numeric(10,2);
  v_occurred_on date;
  v_today date;
begin
  if p_event_id is null or p_player_id is null then
    return;
  end if;

  select
    e.id,
    e.club_id,
    e.event_type,
    e.status,
    e.starts_at
  into v_event
  from public.club_events e
  where e.id = p_event_id;

  if v_event.id is null then
    return;
  end if;

  -- Always clear current derived bonus row first, then possibly reinsert.
  delete from public.om_bonus_entries b
  where b.source_table = 'club_event_attendees'
    and b.source_id = p_event_id
    and b.player_id = p_player_id
    and b.bonus_type in ('training_presence', 'camp_day_presence');

  if coalesce(p_status, '') <> 'present' then
    return;
  end if;

  if coalesce(v_event.status, 'scheduled') <> 'scheduled' then
    return;
  end if;

  if v_event.event_type = 'training' then
    v_bonus_type := 'training_presence';
    v_points := 5;
  elsif v_event.event_type = 'camp' then
    v_bonus_type := 'camp_day_presence';
    v_points := 15;
  else
    return;
  end if;

  v_occurred_on := (v_event.starts_at at time zone 'Europe/Zurich')::date;
  v_today := (now() at time zone 'Europe/Zurich')::date;
  if v_occurred_on > v_today then
    return;
  end if;

  insert into public.om_bonus_entries (
    organization_id,
    player_id,
    bonus_type,
    points_net,
    points_brut,
    source_table,
    source_id,
    description,
    occurred_on,
    created_by
  )
  values (
    v_event.club_id,
    p_player_id,
    v_bonus_type,
    v_points,
    v_points,
    'club_event_attendees',
    p_event_id,
    case
      when v_bonus_type = 'training_presence' then 'Club training attendance'
      else 'Club camp attendance'
    end,
    v_occurred_on,
    null
  );
end;
$$;

grant execute on function public.om_sync_bonus_for_attendee(uuid, uuid, text) to authenticated;

create or replace function public.om_on_club_event_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.om_sync_bonus_for_attendee(old.event_id, old.player_id, null);
    return old;
  end if;

  perform public.om_sync_bonus_for_attendee(new.event_id, new.player_id, new.status);
  return new;
end;
$$;

drop trigger if exists trg_om_bonus_on_club_event_attendees on public.club_event_attendees;
create trigger trg_om_bonus_on_club_event_attendees
after insert or update or delete on public.club_event_attendees
for each row execute function public.om_on_club_event_attendance_change();

create or replace function public.om_on_club_event_changed_resync_attendees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select a.player_id, a.status
    from public.club_event_attendees a
    where a.event_id = new.id
  loop
    perform public.om_sync_bonus_for_attendee(new.id, r.player_id, r.status);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_om_bonus_on_club_events on public.club_events;
create trigger trg_om_bonus_on_club_events
after update of starts_at, status, event_type on public.club_events
for each row execute function public.om_on_club_event_changed_resync_attendees();

-- Backfill existing present attendances for past events.
with src as (
  select
    e.id as event_id,
    e.club_id as organization_id,
    a.player_id,
    case
      when e.event_type = 'training' then 'training_presence'
      when e.event_type = 'camp' then 'camp_day_presence'
      else null
    end as bonus_type,
    case
      when e.event_type = 'training' then 5::numeric(10,2)
      when e.event_type = 'camp' then 15::numeric(10,2)
      else 0::numeric(10,2)
    end as pts,
    (e.starts_at at time zone 'Europe/Zurich')::date as occurred_on
  from public.club_event_attendees a
  join public.club_events e on e.id = a.event_id
  where a.status = 'present'
    and e.status = 'scheduled'
    and e.event_type in ('training', 'camp')
    and (e.starts_at at time zone 'Europe/Zurich')::date <= (now() at time zone 'Europe/Zurich')::date
)
insert into public.om_bonus_entries (
  organization_id,
  player_id,
  bonus_type,
  points_net,
  points_brut,
  source_table,
  source_id,
  description,
  occurred_on,
  created_by
)
select
  s.organization_id,
  s.player_id,
  s.bonus_type,
  s.pts,
  s.pts,
  'club_event_attendees',
  s.event_id,
  case
    when s.bonus_type = 'training_presence' then 'Club training attendance'
    else 'Club camp attendance'
  end,
  s.occurred_on,
  null
from src s
where s.bonus_type is not null
  and not exists (
    select 1
    from public.om_bonus_entries b
    where b.source_table = 'club_event_attendees'
      and b.source_id = s.event_id
      and b.player_id = s.player_id
      and b.bonus_type = s.bonus_type
  );
