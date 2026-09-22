-- Junior golf rules learning. Source baseline: Rules of Golf 2023 and R&A
-- Additional Clarifications updated 2026-07-01. Draft content must be approved
-- by a qualified rules editor before publication.

create table if not exists public.rules_seasons (
  id uuid primary key default gen_random_uuid(), slug text not null unique,
  title_i18n jsonb not null default '{}'::jsonb, status text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  reference_version text not null, display_timezone text not null default 'Europe/Zurich',
  points_per_correct integer not null default 100 check (points_per_correct >= 0),
  speed_bonus_enabled boolean not null default true, max_speed_bonus integer not null default 15 check (max_speed_bonus >= 0),
  free_reading_seconds integer not null default 5 check (free_reading_seconds >= 0),
  speed_decay_seconds integer not null default 15 check (speed_decay_seconds >= 0),
  perfect_bonus integer not null default 50 check (perfect_bonus >= 0),
  retained_scores integer not null default 10 check (retained_scores in (10,15)),
  minimum_club_participants integer not null default 3 check (minimum_club_participants > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.rules_series (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.rules_seasons(id) on delete cascade,
  position smallint not null check (position between 1 and 12), title_i18n jsonb not null default '{}'::jsonb,
  discovery_starts_at timestamptz not null, quiz_opens_at timestamptz not null,
  quiz_closes_at timestamptz not null, results_published_at timestamptz,
  archived_at timestamptz, status text not null default 'draft' check (status in ('draft','scheduled','published','locked','archived')),
  published_at timestamptz, locked_at timestamptz,
  unique (season_id, position),
  check (discovery_starts_at < quiz_opens_at and quiz_opens_at < quiz_closes_at),
  check (results_published_at is null or results_published_at >= quiz_closes_at)
);

create table if not exists public.rules_cards (
  id uuid primary key default gen_random_uuid(), stable_key text not null unique,
  difficulty text not null default 'beginner' check (difficulty in ('beginner','intermediate','advanced')),
  recommended_age_min smallint check (recommended_age_min between 4 and 25), recommended_age_max smallint check (recommended_age_max between 4 and 25),
  editorial_status text not null default 'draft' check (editorial_status in ('draft','needs_review','approved','archived')),
  created_at timestamptz not null default now(), check (recommended_age_max is null or recommended_age_min is null or recommended_age_max >= recommended_age_min)
);

create table if not exists public.rules_card_versions (
  id uuid primary key default gen_random_uuid(), card_id uuid not null references public.rules_cards(id) on delete restrict,
  version integer not null check (version > 0), locale text not null default 'fr' check (locale in ('fr','en')),
  title text not null, situation text not null, simple_explanation text not null, action_text text not null,
  common_mistake text not null, coach_tip text not null, official_reference text not null,
  reference_version text not null, illustration_prompt text not null, image_url text, image_alt text not null,
  image_credit text, image_status text not null default 'pending' check (image_status in ('pending','approved','rejected')),
  human_review_required boolean not null default true, approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz, created_at timestamptz not null default now(), unique(card_id, version, locale)
);

create table if not exists public.rules_series_cards (
  series_id uuid not null references public.rules_series(id) on delete cascade,
  card_version_id uuid not null references public.rules_card_versions(id) on delete restrict,
  position smallint not null check (position between 1 and 6), primary key(series_id, card_version_id), unique(series_id, position)
);

create table if not exists public.rules_questions (
  id uuid primary key default gen_random_uuid(), card_version_id uuid not null references public.rules_card_versions(id) on delete restrict,
  kind text not null check (kind in ('practice','official')), variant smallint not null default 1 check (variant > 0),
  prompt text not null, explanation text not null, illustration_prompt text not null, image_url text, image_alt text not null,
  allows_multiple boolean not null default false, editorial_status text not null default 'draft' check (editorial_status in ('draft','needs_review','approved','archived')),
  unique(card_version_id, kind, variant)
);

create table if not exists public.rules_question_options (
  id uuid primary key default gen_random_uuid(), question_id uuid not null references public.rules_questions(id) on delete cascade,
  position smallint not null check (position between 1 and 6), label text not null, is_correct boolean not null default false,
  explanation text not null, unique(question_id, position)
);

create table if not exists public.rules_club_participations (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.rules_seasons(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade, enabled boolean not null default true,
  retained_scores_override integer check (retained_scores_override in (10,15)), minimum_participants_override integer check (minimum_participants_override > 0),
  visibility text not null default 'first_initial' check (visibility in ('anonymous','display_name','first_initial')),
  joined_at timestamptz not null default now(), unique(season_id, club_id)
);

create table if not exists public.rules_participation_groups (
  participation_id uuid not null references public.rules_club_participations(id) on delete cascade,
  group_id uuid not null references public.coach_groups(id) on delete cascade, primary key(participation_id, group_id)
);

create table if not exists public.rules_card_progress (
  player_user_id uuid not null references public.profiles(id) on delete cascade,
  card_version_id uuid not null references public.rules_card_versions(id) on delete restrict,
  first_read_at timestamptz not null default now(), last_read_at timestamptz not null default now(), review_count integer not null default 0,
  primary key(player_user_id, card_version_id)
);

create table if not exists public.rules_coach_coverage (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.coach_groups(id) on delete cascade,
  card_version_id uuid not null references public.rules_card_versions(id) on delete restrict,
  coach_user_id uuid not null references public.profiles(id) on delete restrict, covered_at timestamptz not null default now(), note text,
  unique(group_id, card_version_id, coach_user_id, covered_at)
);

create table if not exists public.rules_quiz_attempts (
  id uuid primary key default gen_random_uuid(), series_id uuid not null references public.rules_series(id) on delete restrict,
  player_user_id uuid not null references public.profiles(id) on delete restrict, club_id uuid not null references public.clubs(id) on delete restrict,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','expired','void')),
  question_order uuid[] not null, started_at timestamptz not null default now(), submitted_at timestamptz,
  correct_count smallint, base_score integer, speed_bonus integer, perfect_bonus integer, total_score integer,
  unique(series_id, player_user_id)
);

create table if not exists public.rules_attempt_questions (
  attempt_id uuid not null references public.rules_quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.rules_questions(id) on delete restrict, position smallint not null,
  option_order uuid[] not null, shown_at timestamptz, answered_at timestamptz, selected_option_ids uuid[],
  is_correct boolean, earned_base integer, earned_speed integer, primary key(attempt_id, question_id), unique(attempt_id, position)
);

create table if not exists public.rules_rewards (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.rules_seasons(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade, scope text not null check(scope in ('club','interclub')),
  kind text not null, title_i18n jsonb not null, description_i18n jsonb not null default '{}'::jsonb,
  criteria jsonb not null default '{}'::jsonb, image_url text, created_by uuid not null references public.profiles(id) on delete restrict
);

create table if not exists public.rules_reward_winners (
  reward_id uuid not null references public.rules_rewards(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null, club_id uuid references public.clubs(id) on delete set null,
  awarded_at timestamptz not null default now(), primary key(reward_id, awarded_at)
);

create table if not exists public.rules_admin_events (
  id bigint generated always as identity primary key, actor_user_id uuid references public.profiles(id) on delete set null,
  entity_type text not null, entity_id uuid, action text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create index if not exists rules_series_calendar_idx on public.rules_series(season_id, discovery_starts_at, quiz_closes_at);
create index if not exists rules_progress_player_idx on public.rules_card_progress(player_user_id, last_read_at desc);
create index if not exists rules_attempt_club_score_idx on public.rules_quiz_attempts(series_id, club_id, status, total_score desc) where status='submitted';
create index if not exists rules_coverage_group_idx on public.rules_coach_coverage(group_id, covered_at desc);
create index if not exists rules_admin_events_entity_idx on public.rules_admin_events(entity_type, entity_id, created_at desc);

create or replace function public.is_app_admin(p_user_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.app_admins where user_id=p_user_id)
$$;

create or replace function public.rules_series_phase(p_series public.rules_series, p_now timestamptz default now()) returns text language sql stable as $$
 select case when p_series.archived_at is not null and p_now >= p_series.archived_at then 'archived'
 when p_series.results_published_at is not null and p_now >= p_series.results_published_at then 'results_published'
 when p_now >= p_series.quiz_closes_at then 'quiz_finished'
 when p_now >= p_series.quiz_opens_at then 'quiz_open'
 when p_now >= p_series.quiz_opens_at - interval '48 hours' then 'quiz_soon'
 when p_now >= p_series.discovery_starts_at then 'learning_open' else 'upcoming' end
$$;

create or replace function public.validate_rules_series_for_publication(p_series_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_cards int; v_invalid int;
begin
  select count(*) into v_cards from rules_series_cards where series_id=p_series_id;
  select count(*) into v_invalid from rules_series_cards sc join rules_card_versions cv on cv.id=sc.card_version_id
  where sc.series_id=p_series_id and (cv.human_review_required or cv.approved_at is null or cv.official_reference=''
    or (select count(*) from rules_questions q where q.card_version_id=cv.id and q.kind='official' and q.editorial_status='approved') < 2
    or exists(select 1 from rules_questions q where q.card_version_id=cv.id and q.editorial_status='approved' and
      (((q.allows_multiple and (select count(*) from rules_question_options o where o.question_id=q.id and o.is_correct) < 1)
        or (not q.allows_multiple and (select count(*) from rules_question_options o where o.question_id=q.id and o.is_correct) <> 1))
       or exists(select 1 from rules_question_options o where o.question_id=q.id and trim(o.explanation)=''))));
  return jsonb_build_object('valid',v_cards=6 and v_invalid=0,'card_count',v_cards,'invalid_card_count',v_invalid);
end $$;

alter table public.rules_seasons enable row level security; alter table public.rules_series enable row level security;
alter table public.rules_cards enable row level security; alter table public.rules_card_versions enable row level security;
alter table public.rules_series_cards enable row level security; alter table public.rules_questions enable row level security;
alter table public.rules_question_options enable row level security; alter table public.rules_club_participations enable row level security;
alter table public.rules_participation_groups enable row level security; alter table public.rules_card_progress enable row level security;
alter table public.rules_coach_coverage enable row level security; alter table public.rules_quiz_attempts enable row level security;
alter table public.rules_attempt_questions enable row level security; alter table public.rules_rewards enable row level security;
alter table public.rules_reward_winners enable row level security; alter table public.rules_admin_events enable row level security;

do $$ begin
  create policy rules_admin_all_seasons on public.rules_seasons for all to authenticated using(public.is_app_admin(auth.uid())) with check(public.is_app_admin(auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin create policy rules_published_seasons_read on public.rules_seasons for select to authenticated using(status in ('published','archived')); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_series_read on public.rules_series for select to authenticated using(status in ('published','locked','archived') or public.is_app_admin(auth.uid())); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_cards_read on public.rules_cards for select to authenticated using(editorial_status in ('approved','archived') or public.is_app_admin(auth.uid())); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_versions_read on public.rules_card_versions for select to authenticated using((approved_at is not null and not human_review_required) or public.is_app_admin(auth.uid())); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_series_cards_read on public.rules_series_cards for select to authenticated using(exists(select 1 from rules_series s where s.id=series_id and s.status in ('published','locked','archived')) or public.is_app_admin(auth.uid())); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_practice_questions_read on public.rules_questions for select to authenticated using((kind='practice' and editorial_status='approved') or public.is_app_admin(auth.uid())); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_practice_options_read on public.rules_question_options for select to authenticated using(exists(select 1 from rules_questions q where q.id=question_id and q.kind='practice' and q.editorial_status='approved') or public.is_app_admin(auth.uid())); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_progress_own on public.rules_card_progress for all to authenticated using(player_user_id=auth.uid()) with check(player_user_id=auth.uid()); exception when duplicate_object then null; end $$;
do $$ begin create policy rules_attempt_own_read on public.rules_quiz_attempts for select to authenticated using(player_user_id=auth.uid() or public.is_app_admin(auth.uid())); exception when duplicate_object then null; end $$;

revoke all on public.rules_questions, public.rules_question_options, public.rules_quiz_attempts, public.rules_attempt_questions from anon;
grant select on public.rules_seasons, public.rules_series, public.rules_cards, public.rules_card_versions, public.rules_series_cards to authenticated;
grant select on public.rules_questions, public.rules_question_options to authenticated;
grant select,insert,update on public.rules_card_progress to authenticated;
grant execute on function public.rules_series_phase(public.rules_series,timestamptz) to authenticated;
grant execute on function public.validate_rules_series_for_publication(uuid) to authenticated;

create or replace function public.start_rules_quiz(p_series_id uuid, p_club_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_attempt uuid; v_order uuid[];
begin
  if not exists(select 1 from rules_series s where s.id=p_series_id and s.status in ('published','locked') and now() between s.quiz_opens_at and s.quiz_closes_at) then raise exception 'Quiz is not open'; end if;
  if not exists(select 1 from club_members cm where cm.club_id=p_club_id and cm.user_id=auth.uid() and cm.role='player' and cm.is_active) then raise exception 'Forbidden'; end if;
  select id into v_attempt from rules_quiz_attempts where series_id=p_series_id and player_user_id=auth.uid();
  if v_attempt is not null then return v_attempt; end if;
  select array_agg(question_id order by random()) into v_order from (
    select distinct on (sc.position) q.id question_id from rules_series_cards sc
    join rules_questions q on q.card_version_id=sc.card_version_id and q.kind='official' and q.editorial_status='approved'
    where sc.series_id=p_series_id order by sc.position, random()
  ) picked;
  if coalesce(array_length(v_order,1),0) <> 6 then raise exception 'Quiz content is incomplete'; end if;
  insert into rules_quiz_attempts(series_id,player_user_id,club_id,question_order) values(p_series_id,auth.uid(),p_club_id,v_order) returning id into v_attempt;
  insert into rules_attempt_questions(attempt_id,question_id,position,option_order)
  select v_attempt,qid,ord,(select array_agg(id order by random()) from rules_question_options where question_id=qid)
  from unnest(v_order) with ordinality x(qid,ord);
  insert into rules_admin_events(actor_user_id,entity_type,entity_id,action) values(auth.uid(),'quiz_attempt',v_attempt,'started');
  return v_attempt;
exception when unique_violation then select id into v_attempt from rules_quiz_attempts where series_id=p_series_id and player_user_id=auth.uid(); return v_attempt;
end $$;

create or replace function public.get_rules_quiz_question(p_attempt_id uuid, p_position smallint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row rules_attempt_questions; v_question rules_questions;
begin
  if not exists(select 1 from rules_quiz_attempts a join rules_series s on s.id=a.series_id where a.id=p_attempt_id and a.player_user_id=auth.uid() and a.status='in_progress' and now()<s.quiz_closes_at) then raise exception 'Attempt unavailable'; end if;
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
  if not exists(select 1 from rules_quiz_attempts a join rules_series s on s.id=a.series_id join rules_attempt_questions aq on aq.attempt_id=a.id
    where a.id=p_attempt_id and a.player_user_id=auth.uid() and a.status='in_progress' and now()<s.quiz_closes_at and aq.question_id=p_question_id and aq.shown_at is not null) then raise exception 'Attempt unavailable'; end if;
  select allows_multiple into v_allows_multiple from rules_questions where id=p_question_id;
  select count(*) into v_selected from unnest(p_option_ids) x(id) join rules_question_options o on o.id=x.id and o.question_id=p_question_id;
  if v_selected<>cardinality(p_option_ids) or v_selected=0 or (not v_allows_multiple and v_selected<>1) then raise exception 'Invalid answer'; end if;
  update rules_attempt_questions set selected_option_ids=p_option_ids,answered_at=now() where attempt_id=p_attempt_id and question_id=p_question_id and answered_at is null;
end $$;

create or replace function public.submit_rules_quiz(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt rules_quiz_attempts; v_season rules_seasons; v_correct int; v_base int; v_speed int; v_perfect int; v_total int;
begin
  select * into v_attempt from rules_quiz_attempts where id=p_attempt_id and player_user_id=auth.uid() for update;
  if v_attempt.status='submitted' then return jsonb_build_object('score',v_attempt.total_score,'correct',v_attempt.correct_count,'idempotent',true); end if;
  if v_attempt.status<>'in_progress' then raise exception 'Attempt unavailable'; end if;
  if exists(select 1 from rules_attempt_questions where attempt_id=p_attempt_id and answered_at is null) then raise exception 'Quiz is incomplete'; end if;
  select season.* into v_season from rules_seasons season join rules_series s on s.season_id=season.id where s.id=v_attempt.series_id;
  update rules_attempt_questions aq set
    is_correct=(select coalesce(array_agg(o.id order by o.id) filter(where o.is_correct),'{}'::uuid[]) = (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(aq.selected_option_ids) x) from rules_question_options o where o.question_id=aq.question_id),
    earned_base=case when (select coalesce(array_agg(o.id order by o.id) filter(where o.is_correct),'{}'::uuid[]) = (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(aq.selected_option_ids) x) from rules_question_options o where o.question_id=aq.question_id) then v_season.points_per_correct else 0 end,
    earned_speed=case when v_season.speed_bonus_enabled and (select coalesce(array_agg(o.id order by o.id) filter(where o.is_correct),'{}'::uuid[]) = (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(aq.selected_option_ids) x) from rules_question_options o where o.question_id=aq.question_id)
      then round(v_season.max_speed_bonus*greatest(0,1-greatest(0,extract(epoch from (aq.answered_at-aq.shown_at))-v_season.free_reading_seconds)/greatest(1,v_season.speed_decay_seconds)))::int else 0 end
  where aq.attempt_id=p_attempt_id;
  select count(*) filter(where is_correct),coalesce(sum(earned_base),0),coalesce(sum(earned_speed),0) into v_correct,v_base,v_speed from rules_attempt_questions where attempt_id=p_attempt_id;
  v_perfect:=case when v_correct=6 then v_season.perfect_bonus else 0 end; v_total:=v_base+v_speed+v_perfect;
  update rules_quiz_attempts set status='submitted',submitted_at=now(),correct_count=v_correct,base_score=v_base,speed_bonus=v_speed,perfect_bonus=v_perfect,total_score=v_total where id=p_attempt_id;
  insert into rules_admin_events(actor_user_id,entity_type,entity_id,action,details) values(auth.uid(),'quiz_attempt',p_attempt_id,'submitted',jsonb_build_object('total',v_total));
  return jsonb_build_object('score',v_total,'correct',v_correct,'base',v_base,'speed_bonus',v_speed,'perfect_bonus',v_perfect,'idempotent',false);
end $$;

revoke all on function public.start_rules_quiz(uuid,uuid), public.get_rules_quiz_question(uuid,smallint), public.answer_rules_quiz_question(uuid,uuid,uuid[]), public.submit_rules_quiz(uuid) from public,anon;
grant execute on function public.start_rules_quiz(uuid,uuid), public.get_rules_quiz_question(uuid,smallint), public.answer_rules_quiz_question(uuid,uuid,uuid[]), public.submit_rules_quiz(uuid) to authenticated;

create or replace function public.get_rules_quiz_result(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt rules_quiz_attempts;
begin
  select * into v_attempt from rules_quiz_attempts where id=p_attempt_id and player_user_id=auth.uid() and status='submitted';
  if v_attempt.id is null then raise exception 'Result unavailable'; end if;
  return jsonb_build_object('score',v_attempt.total_score,'correct',v_attempt.correct_count,'base',v_attempt.base_score,'speed_bonus',v_attempt.speed_bonus,'perfect_bonus',v_attempt.perfect_bonus,
    'questions',(select jsonb_agg(jsonb_build_object('position',aq.position,'prompt',q.prompt,'correct',aq.is_correct,'explanation',q.explanation,
      'selected',aq.selected_option_ids,'options',(select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'correct',o.is_correct,'explanation',o.explanation) order by array_position(aq.option_order,o.id)) from rules_question_options o where o.question_id=q.id)) order by aq.position)
      from rules_attempt_questions aq join rules_questions q on q.id=aq.question_id where aq.attempt_id=p_attempt_id));
end $$;
revoke all on function public.get_rules_quiz_result(uuid) from public,anon;
grant execute on function public.get_rules_quiz_result(uuid) to authenticated;
