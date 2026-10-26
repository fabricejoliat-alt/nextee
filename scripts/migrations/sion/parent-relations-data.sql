-- Run inside the same transaction as 20261212_neutral_parent_relationship.sql.
-- Approved scope: the 119 existing Sion links previously recorded as 'other'.
do $correction$
declare
  club constant uuid := '97b6dce7-e904-4751-9184-72d9080a0c68';
  actor constant uuid := 'd782fdb0-aa31-46ea-93ef-75796b1d4e07';
  expected_links constant text := '0ee0cbae5ecd7cb389c2bca4816f1299';
  before_links jsonb;
  after_links jsonb;
  before_scopes jsonb;
  before_decisions jsonb;
  before_assertions jsonb;
  before_memberships jsonb;
  selected_keys jsonb;
  affected integer;
  document_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('sion_neutral_parent_relationship',0));
  lock table public.player_guardians in share row exclusive mode;
  lock table public.player_guardian_scopes in share row exclusive mode;

  if exists(select 1 from public.organization_audit_events where organization_id=club
      and action='sion_neutral_parent_relationship') then
    raise exception 'Correction already recorded; inspect the receipt instead of replaying';
  end if;
  select jsonb_agg(jsonb_build_object('player_id',g.player_id,'guardian_user_id',g.guardian_user_id) order by g.player_id,g.guardian_user_id)
    into selected_keys from public.player_guardians g
    join public.player_guardian_scopes s using(player_id,guardian_user_id)
    join public.organization_members m on m.organization_id=s.organization_id and m.user_id=g.player_id and m.role='player' and m.is_active
    where s.organization_id=club and s.status='active' and s.can_view and s.can_edit and g.relation='other';
  if jsonb_array_length(selected_keys) is distinct from 119
    or (select md5(string_agg((x->>'player_id')||':'||(x->>'guardian_user_id'),',' order by x->>'player_id',x->>'guardian_user_id'))
      from jsonb_array_elements(selected_keys) x) is distinct from expected_links then
    raise exception 'Reviewed Sion family links changed';
  end if;
  if exists(select 1 from jsonb_array_elements(selected_keys) x
      join public.player_guardians g on g.player_id=(x->>'player_id')::uuid and g.guardian_user_id=(x->>'guardian_user_id')::uuid
      where not g.can_view or not g.can_edit
        or not exists(select 1 from public.organization_members m where m.organization_id=club and m.user_id=g.guardian_user_id and m.role='parent' and m.is_active)
        or exists(select 1 from public.player_guardian_scopes s where s.player_id=g.player_id and s.guardian_user_id=g.guardian_user_id
          and s.organization_id<>club and s.status in ('pending','active'))
        or exists(select 1 from public.legal_representative_assertions a where a.guardian_id=g.guardian_user_id and a.child_id=g.player_id and a.club_id=club and a.status='revoked')) then
    raise exception 'Existing family rights or organization scope changed';
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.player_guardians'::regclass and not tgisinternal) then
    raise exception 'Unexpected family trigger: review side effects first';
  end if;
  if (select count(*) from public.legal_documents d where d.club_id=club and d.active
      and d.kind='parent_authorization' and d.purpose_key='service.parent_authorization')<>1 then
    raise exception 'Expected one active Sion parent authorization document';
  end if;
  select d.id into document_id from public.legal_documents d where d.club_id=club and d.active
    and d.kind='parent_authorization' and d.purpose_key='service.parent_authorization';

  select jsonb_agg(to_jsonb(g) order by g.player_id,g.guardian_user_id) into before_links from public.player_guardians g;
  select jsonb_agg(to_jsonb(s) order by s.organization_id,s.player_id,s.guardian_user_id) into before_scopes from public.player_guardian_scopes s;
  select jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text) into before_decisions from public.legal_current_state s;
  select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) into before_assertions from public.legal_representative_assertions a;
  select jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text) into before_memberships from public.organization_members m;

  perform set_config('activitee.actor_id',actor::text,true);
  insert into public.organization_audit_events(organization_id,object_type,object_id,actor_id,action,previous_state,next_state)
    select club,'player_guardians',g.player_id::text||':'||g.guardian_user_id::text,actor,
      'sion_neutral_parent_relationship',to_jsonb(g),
      jsonb_build_object('relation','parent','basis','Club administrator confirmed existing parent links','consent_submitted',false)
    from public.player_guardians g join jsonb_array_elements(selected_keys) x
      on g.player_id=(x->>'player_id')::uuid and g.guardian_user_id=(x->>'guardian_user_id')::uuid;
  update public.player_guardians g set relation='parent'
    from jsonb_array_elements(selected_keys) x
    where g.player_id=(x->>'player_id')::uuid and g.guardian_user_id=(x->>'guardian_user_id')::uuid and g.relation='other';
  get diagnostics affected=row_count;
  if affected<>119 then raise exception 'Unexpected corrected relationship count'; end if;

  -- Normalize only the approved value in the comparison; every other value,
  -- link, organization scope, consent state and representative assertion stays exact.
  select jsonb_agg(case when exists(select 1 from jsonb_array_elements(selected_keys) x
      where g.player_id=(x->>'player_id')::uuid and g.guardian_user_id=(x->>'guardian_user_id')::uuid)
    then to_jsonb(g)||'{"relation":"other"}'::jsonb else to_jsonb(g) end order by g.player_id,g.guardian_user_id)
    into after_links from public.player_guardians g;
  if after_links is distinct from before_links
    or (select jsonb_agg(to_jsonb(s) order by s.organization_id,s.player_id,s.guardian_user_id) from public.player_guardian_scopes s) is distinct from before_scopes
    or (select jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text) from public.legal_current_state s) is distinct from before_decisions
    or (select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.legal_representative_assertions a) is distinct from before_assertions
    or (select jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text) from public.organization_members m) is distinct from before_memberships then
    raise exception 'Unexpected change outside the approved relationship field';
  end if;
  if exists(select 1 from jsonb_array_elements(selected_keys) x
      join public.organization_members m on m.user_id=(x->>'player_id')::uuid and m.organization_id=club and m.role='player'
      where public.legal_document_actor_allowed(document_id,(x->>'guardian_user_id')::uuid,(x->>'player_id')::uuid,'parent')
        is distinct from (m.player_consent_status is distinct from 'adult')) then
    raise exception 'Parent authorization eligibility does not match existing player status';
  end if;
end $correction$;
