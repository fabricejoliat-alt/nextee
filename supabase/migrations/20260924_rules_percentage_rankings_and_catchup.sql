-- Fair season rankings for clubs joining after the season has started.
-- Raw points remain unchanged; percentages are derived at read time.

alter table public.rules_seasons
  add column if not exists minimum_player_series smallint not null default 4
  check (minimum_player_series between 1 and 12);

alter table public.rules_seasons
  alter column minimum_club_participants set default 5;

update public.rules_seasons
set minimum_club_participants = 5
where slug = 'junior-rules-2027' and minimum_club_participants = 3;

create table if not exists public.rules_quiz_attempt_clubs (
  attempt_id uuid not null references public.rules_quiz_attempts(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  attached_at timestamptz not null default now(),
  primary key (attempt_id, club_id)
);

alter table public.rules_quiz_attempt_clubs enable row level security;
revoke all on public.rules_quiz_attempt_clubs from anon, authenticated;

-- Snapshot every active Player membership for attempts that already exist.
insert into public.rules_quiz_attempt_clubs(attempt_id,club_id)
select distinct attempt.id,membership.club_id
from public.rules_quiz_attempts attempt
join public.club_members membership on membership.user_id=attempt.player_user_id
  and membership.role='player' and membership.is_active
on conflict(attempt_id,club_id) do nothing;

-- A club added later in the season also receives the player's existing season results.
create or replace function public.sync_rules_attempt_clubs_for_membership()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='player' and new.is_active then
    insert into public.rules_quiz_attempt_clubs(attempt_id,club_id)
    select attempt.id,new.club_id
    from public.rules_quiz_attempts attempt
    where attempt.player_user_id=new.user_id
    on conflict(attempt_id,club_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_rules_attempt_clubs_for_membership() from public,anon,authenticated;
drop trigger if exists sync_rules_attempt_clubs_for_membership on public.club_members;
create trigger sync_rules_attempt_clubs_for_membership
after insert or update of club_id,user_id,role,is_active on public.club_members
for each row execute function public.sync_rules_attempt_clubs_for_membership();

create or replace function public.can_access_rules_quiz(
  p_series_id uuid,
  p_club_id uuid,
  p_user_id uuid
) returns boolean
language sql stable security definer set search_path=public as $$
  select p_user_id = auth.uid()
    and exists (
      select 1
      from public.club_members cm
      where cm.club_id = p_club_id
        and cm.user_id = p_user_id
        and cm.role = 'player'
        and cm.is_active
    )
    and exists (
      select 1
      from public.rules_series s
      join public.rules_seasons season on season.id = s.season_id
      where s.id = p_series_id
        and season.status = 'published'
        and s.status in ('published','locked','archived')
        and (
          now() between s.quiz_opens_at and s.quiz_closes_at
          or exists (
            select 1
            from public.rules_club_participations participation
            where participation.season_id = s.season_id
              and participation.club_id = p_club_id
              and participation.enabled
              and participation.joined_at > s.quiz_closes_at
          )
        )
    );
$$;

revoke all on function public.can_access_rules_quiz(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.start_rules_quiz(p_series_id uuid, p_club_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_attempt uuid; v_order uuid[];
begin
  if not public.can_access_rules_quiz(p_series_id,p_club_id,auth.uid()) then raise exception 'Quiz is not open'; end if;
  select id into v_attempt from rules_quiz_attempts where series_id=p_series_id and player_user_id=auth.uid();
  if v_attempt is not null then
    insert into rules_quiz_attempt_clubs(attempt_id,club_id)
    select v_attempt,membership.club_id
    from club_members membership
    where membership.user_id=auth.uid() and membership.role='player' and membership.is_active
    on conflict(attempt_id,club_id) do nothing;
    return v_attempt;
  end if;
  select array_agg(question_id order by random()) into v_order from (
    select distinct on (sc.position) q.id question_id from rules_series_cards sc
    join rules_questions q on q.card_version_id=sc.card_version_id and q.kind='official' and q.editorial_status='approved'
    where sc.series_id=p_series_id order by sc.position, random()
  ) picked;
  if coalesce(array_length(v_order,1),0) <> 6 then raise exception 'Quiz content is incomplete'; end if;
  insert into rules_quiz_attempts(series_id,player_user_id,club_id,question_order) values(p_series_id,auth.uid(),p_club_id,v_order) returning id into v_attempt;
  insert into rules_quiz_attempt_clubs(attempt_id,club_id)
  select v_attempt,membership.club_id
  from club_members membership
  where membership.user_id=auth.uid() and membership.role='player' and membership.is_active
  on conflict(attempt_id,club_id) do nothing;
  insert into rules_attempt_questions(attempt_id,question_id,position,option_order)
  select v_attempt,qid,ord,(select array_agg(id order by random()) from rules_question_options where question_id=qid)
  from unnest(v_order) with ordinality x(qid,ord);
  insert into rules_admin_events(actor_user_id,entity_type,entity_id,action) values(auth.uid(),'quiz_attempt',v_attempt,'started');
  return v_attempt;
exception when unique_violation then
  select id into v_attempt from rules_quiz_attempts where series_id=p_series_id and player_user_id=auth.uid();
  insert into rules_quiz_attempt_clubs(attempt_id,club_id)
  select v_attempt,membership.club_id
  from club_members membership
  where membership.user_id=auth.uid() and membership.role='player' and membership.is_active
  on conflict(attempt_id,club_id) do nothing;
  return v_attempt;
end $$;

create or replace function public.get_rules_quiz_question(p_attempt_id uuid, p_position smallint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row rules_attempt_questions; v_question rules_questions;
begin
  if not exists(
    select 1 from rules_quiz_attempts a
    where a.id=p_attempt_id and a.player_user_id=auth.uid() and a.status='in_progress'
      and public.can_access_rules_quiz(a.series_id,a.club_id,a.player_user_id)
  ) then raise exception 'Attempt unavailable'; end if;
  update rules_attempt_questions set shown_at=coalesce(shown_at,now()) where attempt_id=p_attempt_id and position=p_position returning * into v_row;
  select * into v_question from rules_questions where id=v_row.question_id;
  return jsonb_build_object('position',p_position,'question_id',v_question.id,'prompt',v_question.prompt,'image_url',v_question.image_url,'image_alt',v_question.image_alt,
    'options',(select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label) order by array_position(v_row.option_order,o.id)) from rules_question_options o where o.question_id=v_question.id),
    'answered',v_row.answered_at is not null,'selected_option_ids',coalesce(v_row.selected_option_ids,'{}'::uuid[]));
end $$;

create or replace function public.answer_rules_quiz_question(p_attempt_id uuid,p_question_id uuid,p_option_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare v_allows_multiple boolean; v_selected int; v_expected int;
begin
  if not exists(
    select 1 from rules_quiz_attempts a join rules_attempt_questions aq on aq.attempt_id=a.id
    where a.id=p_attempt_id and a.player_user_id=auth.uid() and a.status='in_progress'
      and public.can_access_rules_quiz(a.series_id,a.club_id,a.player_user_id)
      and aq.question_id=p_question_id and aq.shown_at is not null
  ) then raise exception 'Attempt unavailable'; end if;
  select allows_multiple into v_allows_multiple from rules_questions where id=p_question_id;
  select count(*) into v_selected from unnest(p_option_ids) x(id) join rules_question_options o on o.id=x.id and o.question_id=p_question_id;
  if v_selected<>cardinality(p_option_ids) or v_selected=0 or (not v_allows_multiple and v_selected<>1) then raise exception 'Invalid answer'; end if;
  update rules_attempt_questions set selected_option_ids=p_option_ids,answered_at=now() where attempt_id=p_attempt_id and question_id=p_question_id and answered_at is null;
end $$;

revoke all on function public.start_rules_quiz(uuid,uuid), public.get_rules_quiz_question(uuid,smallint), public.answer_rules_quiz_question(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.start_rules_quiz(uuid,uuid), public.get_rules_quiz_question(uuid,smallint), public.answer_rules_quiz_question(uuid,uuid,uuid[]) to authenticated;
