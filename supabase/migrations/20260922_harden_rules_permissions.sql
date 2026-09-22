-- Follow-up hardening for installations where the core migrations have already
-- been applied. This migration is additive and safe to run more than once.

alter table public.rules_seasons enable row level security;
alter table public.rules_series enable row level security;
alter table public.rules_cards enable row level security;
alter table public.rules_card_versions enable row level security;
alter table public.rules_series_cards enable row level security;
alter table public.rules_questions enable row level security;
alter table public.rules_question_options enable row level security;
alter table public.rules_club_participations enable row level security;
alter table public.rules_participation_groups enable row level security;
alter table public.rules_card_progress enable row level security;
alter table public.rules_coach_coverage enable row level security;
alter table public.rules_quiz_attempts enable row level security;
alter table public.rules_attempt_questions enable row level security;
alter table public.rules_rewards enable row level security;
alter table public.rules_reward_winners enable row level security;
alter table public.rules_admin_events enable row level security;

create or replace function public.rules_is_club_manager(p_club_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.club_members cm
    where cm.club_id=p_club_id and cm.user_id=p_user_id
      and cm.role='manager' and cm.is_active=true
  )
$$;

create or replace function public.rules_coach_can_follow_player(p_player_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.coach_group_players gp
    join public.coach_groups g on g.id=gp.group_id and g.is_active=true
    join public.club_members coach on coach.club_id=g.club_id
      and coach.user_id=p_user_id and coach.role='coach' and coach.is_active=true
    where gp.player_user_id=p_player_id
      and (g.head_coach_user_id=p_user_id or exists (
        select 1 from public.coach_group_coaches cgc
        where cgc.group_id=g.id and cgc.coach_user_id=p_user_id
      ))
  )
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'rules_series','rules_cards','rules_card_versions','rules_series_cards',
    'rules_questions','rules_question_options','rules_club_participations',
    'rules_participation_groups','rules_card_progress','rules_coach_coverage',
    'rules_quiz_attempts','rules_attempt_questions','rules_rewards',
    'rules_reward_winners','rules_admin_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'rules_admin_all_'||v_table, v_table);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_app_admin(auth.uid())) with check (public.is_app_admin(auth.uid()))',
      'rules_admin_all_'||v_table, v_table
    );
  end loop;
end;
$$;

drop policy if exists rules_guardian_progress_read on public.rules_card_progress;
create policy rules_guardian_progress_read on public.rules_card_progress for select to authenticated
using (exists (
  select 1 from public.player_guardians pg
  where pg.player_id=rules_card_progress.player_user_id and pg.guardian_user_id=auth.uid()
));

drop policy if exists rules_staff_attempts_read on public.rules_quiz_attempts;
create policy rules_staff_attempts_read on public.rules_quiz_attempts for select to authenticated
using (
  status='submitted' and (
    public.rules_is_club_manager(club_id,auth.uid())
    or public.rules_coach_can_follow_player(player_user_id,auth.uid())
    or exists (select 1 from public.player_guardians pg where pg.player_id=player_user_id and pg.guardian_user_id=auth.uid())
  )
);

drop policy if exists rules_manager_participations_manage on public.rules_club_participations;
create policy rules_manager_participations_manage on public.rules_club_participations for all to authenticated
using (public.rules_is_club_manager(club_id,auth.uid()))
with check (public.rules_is_club_manager(club_id,auth.uid()));

drop policy if exists rules_manager_participation_groups_manage on public.rules_participation_groups;
create policy rules_manager_participation_groups_manage on public.rules_participation_groups for all to authenticated
using (exists (
  select 1 from public.rules_club_participations p
  where p.id=participation_id and public.rules_is_club_manager(p.club_id,auth.uid())
))
with check (exists (
  select 1 from public.rules_club_participations p
  where p.id=participation_id and public.rules_is_club_manager(p.club_id,auth.uid())
));

drop policy if exists rules_group_staff_coverage_manage on public.rules_coach_coverage;
create policy rules_group_staff_coverage_manage on public.rules_coach_coverage for all to authenticated
using (exists (
  select 1 from public.coach_groups g
  where g.id=group_id and (
    public.rules_is_club_manager(g.club_id,auth.uid())
    or g.head_coach_user_id=auth.uid()
    or exists (select 1 from public.coach_group_coaches cgc where cgc.group_id=g.id and cgc.coach_user_id=auth.uid())
  )
))
with check (coach_user_id=auth.uid() and exists (
  select 1 from public.coach_groups g
  where g.id=group_id and (
    g.head_coach_user_id=auth.uid()
    or exists (select 1 from public.coach_group_coaches cgc where cgc.group_id=g.id and cgc.coach_user_id=auth.uid())
  )
));

drop policy if exists rules_rewards_read on public.rules_rewards;
create policy rules_rewards_read on public.rules_rewards for select to authenticated using(true);

drop policy if exists rules_manager_club_rewards_manage on public.rules_rewards;
create policy rules_manager_club_rewards_manage on public.rules_rewards for all to authenticated
using (scope='club' and club_id is not null and public.rules_is_club_manager(club_id,auth.uid()))
with check (scope='club' and club_id is not null and public.rules_is_club_manager(club_id,auth.uid()) and created_by=auth.uid());

drop policy if exists rules_reward_winners_read on public.rules_reward_winners;
create policy rules_reward_winners_read on public.rules_reward_winners for select to authenticated
using (exists (select 1 from public.rules_rewards r where r.id=reward_id));

revoke execute on function public.validate_rules_series_for_publication(uuid) from authenticated,anon,public;
grant execute on function public.validate_rules_series_for_publication(uuid) to service_role;

create or replace function public.admin_save_rules_question(
  p_actor_user_id uuid,
  p_card_version_id uuid,
  p_question_id uuid,
  p_kind text,
  p_variant integer,
  p_prompt text,
  p_explanation text,
  p_illustration_prompt text,
  p_image_url text,
  p_image_alt text,
  p_allows_multiple boolean,
  p_editorial_status text,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_question_id uuid;
  v_option jsonb;
  v_option_count integer;
  v_correct_count integer;
  v_position integer;
begin
  if not public.is_app_admin(p_actor_user_id) then
    raise exception 'Forbidden';
  end if;
  if not exists (
    select 1 from public.rules_card_versions
    where id=p_card_version_id and approved_at is null
  ) then
    raise exception 'Card version is missing or locked';
  end if;
  if p_kind not in ('practice','official') or p_variant < 1 then
    raise exception 'Invalid question kind or variant';
  end if;
  if trim(coalesce(p_prompt,''))='' or trim(coalesce(p_explanation,''))=''
    or trim(coalesce(p_illustration_prompt,''))='' or trim(coalesce(p_image_alt,''))='' then
    raise exception 'Question content is incomplete';
  end if;
  if p_editorial_status not in ('draft','needs_review','approved') then
    raise exception 'Invalid editorial status';
  end if;
  if jsonb_typeof(p_options) <> 'array' then
    raise exception 'Options must be an array';
  end if;

  v_option_count := jsonb_array_length(p_options);
  select count(*) into v_correct_count
  from jsonb_array_elements(p_options) option_row
  where coalesce((option_row->>'is_correct')::boolean,false);
  if v_option_count not between 3 and 4 then
    raise exception 'A question must have 3 or 4 options';
  end if;
  if (not p_allows_multiple and v_correct_count <> 1)
    or (p_allows_multiple and v_correct_count < 1) then
    raise exception 'Invalid number of correct options';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_options) option_row
    where trim(coalesce(option_row->>'label',''))=''
      or trim(coalesce(option_row->>'explanation',''))=''
  ) then
    raise exception 'Every option needs a label and an explanation';
  end if;

  if p_question_id is null then
    insert into public.rules_questions(
      card_version_id,kind,variant,prompt,explanation,illustration_prompt,
      image_url,image_alt,allows_multiple,editorial_status
    ) values (
      p_card_version_id,p_kind,p_variant,trim(p_prompt),trim(p_explanation),
      trim(p_illustration_prompt),nullif(trim(coalesce(p_image_url,'')),''),
      trim(p_image_alt),p_allows_multiple,p_editorial_status
    ) returning id into v_question_id;
  else
    update public.rules_questions set
      kind=p_kind,variant=p_variant,prompt=trim(p_prompt),
      explanation=trim(p_explanation),illustration_prompt=trim(p_illustration_prompt),
      image_url=nullif(trim(coalesce(p_image_url,'')),''),image_alt=trim(p_image_alt),
      allows_multiple=p_allows_multiple,editorial_status=p_editorial_status
    where id=p_question_id and card_version_id=p_card_version_id
    returning id into v_question_id;
    if v_question_id is null then raise exception 'Question not found'; end if;
  end if;

  v_position := 0;
  for v_option in select value from jsonb_array_elements(p_options) loop
    v_position := v_position + 1;
    insert into public.rules_question_options(question_id,position,label,is_correct,explanation)
    values(
      v_question_id,v_position,trim(v_option->>'label'),
      coalesce((v_option->>'is_correct')::boolean,false),trim(v_option->>'explanation')
    )
    on conflict(question_id,position) do update set
      label=excluded.label,is_correct=excluded.is_correct,explanation=excluded.explanation;
  end loop;
  delete from public.rules_question_options
  where question_id=v_question_id and position > v_option_count;

  insert into public.rules_admin_events(actor_user_id,entity_type,entity_id,action,details)
  values(p_actor_user_id,'question',v_question_id,
    case when p_question_id is null then 'created' else 'updated' end,
    jsonb_build_object('card_version_id',p_card_version_id,'kind',p_kind,'variant',p_variant));
  return v_question_id;
end;
$$;

create or replace function public.admin_delete_rules_question(
  p_actor_user_id uuid,
  p_card_version_id uuid,
  p_question_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_app_admin(p_actor_user_id) then raise exception 'Forbidden'; end if;
  if not exists (
    select 1 from public.rules_card_versions
    where id=p_card_version_id and approved_at is null
  ) then raise exception 'Card version is missing or locked'; end if;
  if not exists (
    select 1 from public.rules_questions
    where id=p_question_id and card_version_id=p_card_version_id
  ) then raise exception 'Question not found'; end if;

  insert into public.rules_admin_events(actor_user_id,entity_type,entity_id,action,details)
  values(p_actor_user_id,'question',p_question_id,'deleted',jsonb_build_object('card_version_id',p_card_version_id));
  delete from public.rules_questions where id=p_question_id and card_version_id=p_card_version_id;
end;
$$;

revoke all on function public.admin_save_rules_question(uuid,uuid,uuid,text,integer,text,text,text,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_save_rules_question(uuid,uuid,uuid,text,integer,text,text,text,text,text,boolean,text,jsonb) to service_role;
revoke all on function public.admin_delete_rules_question(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_rules_question(uuid,uuid,uuid) to service_role;
grant execute on function public.rules_is_club_manager(uuid,uuid) to authenticated,service_role;
grant execute on function public.rules_coach_can_follow_player(uuid,uuid) to authenticated,service_role;

create or replace function public.validate_rules_series_for_publication(p_series_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_cards integer;
  v_invalid integer;
begin
  select count(*) into v_cards from public.rules_series_cards where series_id=p_series_id;
  select count(*) into v_invalid
  from public.rules_series_cards sc
  join public.rules_card_versions cv on cv.id=sc.card_version_id
  join public.rules_cards c on c.id=cv.card_id
  where sc.series_id=p_series_id and (
    c.editorial_status<>'approved'
    or cv.human_review_required
    or cv.approved_at is null
    or trim(cv.official_reference)=''
    or trim(cv.situation)=''
    or trim(cv.simple_explanation)=''
    or trim(cv.action_text)=''
    or trim(cv.common_mistake)=''
    or trim(cv.coach_tip)=''
    or trim(cv.image_alt)=''
    or (select count(*) from public.rules_questions q where q.card_version_id=cv.id and q.kind='practice' and q.editorial_status='approved')<1
    or (select count(*) from public.rules_questions q where q.card_version_id=cv.id and q.kind='official' and q.editorial_status='approved')<2
    or exists (
      select 1 from public.rules_questions q
      where q.card_version_id=cv.id and q.editorial_status='approved' and (
        trim(q.prompt)='' or trim(q.explanation)='' or trim(q.image_alt)=''
        or (select count(*) from public.rules_question_options o where o.question_id=q.id) not between 3 and 4
        or (not q.allows_multiple and (select count(*) from public.rules_question_options o where o.question_id=q.id and o.is_correct)<>1)
        or (q.allows_multiple and (select count(*) from public.rules_question_options o where o.question_id=q.id and o.is_correct)<1)
        or exists (select 1 from public.rules_question_options o where o.question_id=q.id and (trim(o.label)='' or trim(o.explanation)=''))
      )
    )
  );
  return jsonb_build_object(
    'valid',v_cards=6 and v_invalid=0,
    'card_count',v_cards,
    'invalid_card_count',v_invalid
  );
end;
$$;

revoke execute on function public.validate_rules_series_for_publication(uuid) from authenticated,anon,public;
grant execute on function public.validate_rules_series_for_publication(uuid) to service_role;
