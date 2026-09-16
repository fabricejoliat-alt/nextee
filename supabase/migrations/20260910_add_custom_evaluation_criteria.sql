-- Club-scoped custom evaluation criteria. Standard evaluation columns remain unchanged.

create table if not exists public.club_evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  description text null,
  respondent text not null,
  response_format text not null,
  choices_json jsonb not null default '[]'::jsonb,
  activity_types text[] not null,
  domain_key text not null,
  domain_label text not null,
  is_required boolean not null default false,
  is_active boolean not null default true,
  archived_at timestamptz null,
  sort_order integer not null default 0,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_evaluation_criteria_name_check check (char_length(btrim(name)) between 1 and 100),
  constraint club_evaluation_criteria_description_check check (description is null or char_length(description) <= 500),
  constraint club_evaluation_criteria_respondent_check check (respondent in ('coach', 'player', 'both')),
  constraint club_evaluation_criteria_format_check check (response_format in ('scale_1_6', 'delta', 'sentiment', 'feeling', 'yes_no', 'short_text')),
  constraint club_evaluation_criteria_activity_types_check check (
    cardinality(activity_types) > 0 and activity_types <@ array['training','interclub','camp','session','event','competition']::text[]
  ),
  constraint club_evaluation_criteria_choices_check check (jsonb_typeof(choices_json) = 'array'),
  constraint club_evaluation_criteria_archive_check check (archived_at is null or is_active = false)
);

create index if not exists club_evaluation_criteria_club_order_idx
  on public.club_evaluation_criteria (club_id, archived_at, is_active, sort_order, created_at);
create index if not exists club_evaluation_criteria_activity_types_idx
  on public.club_evaluation_criteria using gin (activity_types);

create table if not exists public.club_event_evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_id uuid not null references public.club_events(id) on delete cascade,
  criterion_id uuid null references public.club_evaluation_criteria(id) on delete restrict,
  snapshot_name text not null,
  snapshot_description text null,
  snapshot_respondent text not null,
  snapshot_response_format text not null,
  snapshot_choices jsonb not null default '[]'::jsonb,
  snapshot_domain_key text not null,
  snapshot_domain_label text not null,
  snapshot_is_required boolean not null default false,
  position smallint not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, criterion_id),
  constraint club_event_evaluation_criteria_position_check check (position between 1 and 3),
  constraint club_event_evaluation_criteria_respondent_check check (snapshot_respondent in ('coach', 'player', 'both')),
  constraint club_event_evaluation_criteria_format_check check (snapshot_response_format in ('scale_1_6', 'delta', 'sentiment', 'feeling', 'yes_no', 'short_text')),
  constraint club_event_evaluation_criteria_choices_check check (jsonb_typeof(snapshot_choices) = 'array')
);

create unique index if not exists club_event_evaluation_criteria_position_unique
  on public.club_event_evaluation_criteria (event_id, position) where is_enabled;
create index if not exists club_event_evaluation_criteria_event_idx
  on public.club_event_evaluation_criteria (event_id, is_enabled, position);
create index if not exists club_event_evaluation_criteria_definition_idx
  on public.club_event_evaluation_criteria (criterion_id);

create table if not exists public.club_event_evaluation_responses (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  event_criterion_id uuid not null references public.club_event_evaluation_criteria(id) on delete restrict,
  event_id uuid not null references public.club_events(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  respondent_user_id uuid not null references auth.users(id) on delete restrict,
  respondent_role text not null,
  value_json jsonb not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_criterion_id, player_id, respondent_role),
  constraint club_event_evaluation_responses_role_check check (respondent_role in ('coach', 'player')),
  constraint club_event_evaluation_responses_value_check check (jsonb_typeof(value_json) in ('string', 'number', 'boolean'))
);

create index if not exists club_event_evaluation_responses_player_idx
  on public.club_event_evaluation_responses (player_id, event_id, respondent_role);
create index if not exists club_event_evaluation_responses_event_idx
  on public.club_event_evaluation_responses (event_id, event_criterion_id);

create or replace function public.prepare_event_evaluation_criterion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_criterion public.club_evaluation_criteria%rowtype;
  v_event_club uuid;
begin
  select * into v_criterion from public.club_evaluation_criteria where id = new.criterion_id;
  select club_id into v_event_club from public.club_events where id = new.event_id;
  if v_criterion.id is null or v_event_club is null or v_criterion.club_id <> v_event_club then
    raise exception 'Criterion and activity must belong to the same club' using errcode = '23514';
  end if;
  if v_criterion.archived_at is not null or not v_criterion.is_active then
    raise exception 'Inactive or archived criterion cannot be selected' using errcode = '23514';
  end if;
  if not exists (select 1 from public.club_events e where e.id = new.event_id and e.event_type = any(v_criterion.activity_types)) then
    raise exception 'Criterion does not apply to this activity type' using errcode = '23514';
  end if;
  if new.is_enabled and (select count(*) from public.club_event_evaluation_criteria x where x.event_id = new.event_id and x.is_enabled and x.id <> new.id) >= 3 then
    raise exception 'Maximum three custom criteria per activity' using errcode = '23514';
  end if;
  new.club_id := v_criterion.club_id;
  if tg_op = 'INSERT' then
    new.snapshot_name := v_criterion.name;
    new.snapshot_description := v_criterion.description;
    new.snapshot_respondent := v_criterion.respondent;
    new.snapshot_response_format := v_criterion.response_format;
    new.snapshot_choices := v_criterion.choices_json;
    new.snapshot_domain_key := v_criterion.domain_key;
    new.snapshot_domain_label := v_criterion.domain_label;
    new.snapshot_is_required := v_criterion.is_required;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prepare_event_evaluation_criterion on public.club_event_evaluation_criteria;
create trigger trg_prepare_event_evaluation_criterion
before insert or update of criterion_id, event_id, position, is_enabled
on public.club_event_evaluation_criteria
for each row execute function public.prepare_event_evaluation_criterion();

create or replace function public.validate_custom_evaluation_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.club_event_evaluation_criteria%rowtype;
  v_format text;
  v_valid boolean;
begin
  select * into v_link from public.club_event_evaluation_criteria where id = new.event_criterion_id;
  if v_link.id is null or v_link.event_id <> new.event_id then raise exception 'Invalid activity criterion'; end if;
  if new.respondent_role = 'coach' and v_link.snapshot_respondent not in ('coach', 'both') then raise exception 'Criterion is not for coaches'; end if;
  if new.respondent_role = 'player' and v_link.snapshot_respondent not in ('player', 'both') then raise exception 'Criterion is not for players'; end if;
  if new.respondent_role = 'player' and new.respondent_user_id <> new.player_id then raise exception 'Player response owner mismatch'; end if;
  new.club_id := v_link.club_id;
  v_format := v_link.snapshot_response_format;
  if v_format = 'short_text' then
    v_valid := jsonb_typeof(new.value_json) = 'string' and char_length(btrim(new.value_json #>> '{}')) between 1 and 240;
  else
    select exists (
      select 1 from jsonb_array_elements(v_link.snapshot_choices) choice
      where choice->'value' = new.value_json
    ) into v_valid;
  end if;
  if not v_valid then raise exception 'Invalid structured response value' using errcode = '23514'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_validate_custom_evaluation_response on public.club_event_evaluation_responses;
create trigger trg_validate_custom_evaluation_response
before insert or update on public.club_event_evaluation_responses
for each row execute function public.validate_custom_evaluation_response();

alter table public.club_evaluation_criteria enable row level security;
alter table public.club_event_evaluation_criteria enable row level security;
alter table public.club_event_evaluation_responses enable row level security;

create or replace function public.can_staff_access_evaluation_event(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_events e
    where e.id = p_event_id
      and (
        public.is_org_manager_member(e.club_id, p_user_id)
        or (e.group_id is not null and public.is_group_staff_member(e.group_id, p_user_id))
        or exists (select 1 from public.club_event_coaches ec where ec.event_id = e.id and ec.coach_id = p_user_id)
      )
  );
$$;

create policy "club managers manage evaluation criteria" on public.club_evaluation_criteria
for all to authenticated using (public.is_org_manager_member(club_id, auth.uid()))
with check (public.is_org_manager_member(club_id, auth.uid()));

create policy "managers manage event evaluation criteria" on public.club_event_evaluation_criteria
for all to authenticated using (public.is_org_manager_member(club_id, auth.uid()))
with check (public.is_org_manager_member(club_id, auth.uid()));

create policy "relevant users read event evaluation criteria" on public.club_event_evaluation_criteria
for select to authenticated using (
  public.can_staff_access_evaluation_event(event_id, auth.uid())
  or exists (select 1 from public.club_event_attendees a where a.event_id = club_event_evaluation_criteria.event_id and a.player_id = auth.uid())
);

create policy "relevant users read evaluation responses" on public.club_event_evaluation_responses
for select to authenticated using (
  public.is_org_manager_member(club_id, auth.uid())
  or (respondent_role = 'coach' and public.can_staff_access_evaluation_event(event_id, auth.uid()))
  or player_id = auth.uid()
);

create policy "coaches write coach evaluation responses" on public.club_event_evaluation_responses
for all to authenticated using (
  respondent_role = 'coach' and respondent_user_id = auth.uid() and public.can_staff_access_evaluation_event(event_id, auth.uid())
) with check (
  respondent_role = 'coach' and respondent_user_id = auth.uid() and public.can_staff_access_evaluation_event(event_id, auth.uid())
  and exists (select 1 from public.club_event_attendees a where a.event_id = club_event_evaluation_responses.event_id and a.player_id = club_event_evaluation_responses.player_id)
);

create policy "players write own evaluation responses" on public.club_event_evaluation_responses
for all to authenticated using (
  respondent_role = 'player' and respondent_user_id = auth.uid() and player_id = auth.uid()
) with check (
  respondent_role = 'player' and respondent_user_id = auth.uid() and player_id = auth.uid()
  and exists (select 1 from public.club_event_attendees a where a.event_id = club_event_evaluation_responses.event_id and a.player_id = auth.uid())
);

grant select, insert, update, delete on public.club_evaluation_criteria to authenticated;
grant select, insert, update, delete on public.club_event_evaluation_criteria to authenticated;
grant select, insert, update, delete on public.club_event_evaluation_responses to authenticated;
