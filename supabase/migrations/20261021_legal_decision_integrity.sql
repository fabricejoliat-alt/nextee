-- Apply after 20261020_legal_documents_foundation.sql. No activation or real data backfill.
-- Serializes parent challenge issuance, preserves withdrawal conflicts and checks idempotent retries.

create function public.create_legal_document(p_key text,p_kind text,p_purpose text,p_scope text,p_club uuid,
  p_roles text[],p_action text,p_required boolean,p_actor uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  if not exists(select 1 from public.app_admins a where a.user_id=p_actor) then raise exception 'Platform admin required'; end if;
  if p_key !~ '^[a-z0-9_-]+$' or length(trim(coalesce(p_purpose,'')))=0
    or p_scope not in ('platform','club') or (p_scope='platform' and p_club is not null)
    or (p_scope='club' and p_club is null) or cardinality(p_roles)=0
    or exists(select 1 from unnest(p_roles) r where r not in ('player','parent','coach','manager','admin'))
  then raise exception 'Invalid document'; end if;
  if not ((p_kind='terms' and p_action='accept')
    or (p_kind='privacy' and p_action in ('acknowledge','read'))
    or (p_kind='parent_authorization' and p_action='authorize' and p_scope='club')
    or (p_kind='specific_consent' and p_action='consent')
    or (p_kind='junior_notice' and p_action in ('read','acknowledge'))) then raise exception 'Invalid document action'; end if;
  insert into public.legal_documents(document_key,kind,purpose_key,scope,club_id,audience_roles,action_kind,required,created_by)
  values(p_key,p_kind,p_purpose,p_scope,p_club,p_roles,p_action,p_required,p_actor) returning id into new_id;
  insert into public.legal_drafts(document_id,updated_by) values(new_id,p_actor);
  return new_id;
end $$;
revoke all on function public.create_legal_document(text,text,text,text,uuid,text[],text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.create_legal_document(text,text,text,text,uuid,text[],text,boolean,uuid) to service_role;

create table public.legal_representative_events (
  id uuid primary key default gen_random_uuid(),
  assertion_id uuid not null references public.legal_representative_assertions(id) on delete restrict,
  guardian_id uuid not null,
  child_id uuid not null,
  club_id uuid not null,
  prior_status text,
  new_status text not null,
  review_basis text not null,
  reviewed_by uuid not null,
  recorded_at timestamptz not null default now()
);
create index legal_representative_events_subject_idx on public.legal_representative_events(child_id,club_id,recorded_at desc);
alter table public.legal_representative_events enable row level security;
revoke all on public.legal_representative_events from anon,authenticated;
create trigger legal_representative_events_immutable before update or delete on public.legal_representative_events
  for each row execute function public.legal_prevent_evidence_mutation();

create function public.review_legal_representative(p_guardian uuid,p_child uuid,p_club uuid,p_status text,p_basis text,p_admin uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare assertion_id uuid; previous text;
begin
  if p_status not in ('verified','revoked') or length(trim(coalesce(p_basis,'')))<20 then raise exception 'Reviewed basis required'; end if;
  if not exists(select 1 from public.app_admins a where a.user_id=p_admin) then raise exception 'Platform admin required'; end if;
  if p_status='verified' then
    if not exists(select 1 from public.player_guardians g where g.guardian_user_id=p_guardian and g.player_id=p_child and g.can_edit)
      or not exists(select 1 from public.club_members m where m.user_id=p_guardian and m.club_id=p_club and m.role='parent' and m.is_active)
      or not exists(select 1 from public.club_members m where m.user_id=p_child and m.club_id=p_club and m.role='player' and m.is_active)
    then raise exception 'Current family access is not sufficient'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('legal_rep:'||p_guardian::text||':'||p_child::text||':'||p_club::text,0));
  select id,status into assertion_id,previous from public.legal_representative_assertions
    where guardian_id=p_guardian and child_id=p_child and club_id=p_club for update;
  if assertion_id is null and p_status='revoked' then raise exception 'Assertion missing'; end if;
  if assertion_id is null then
    insert into public.legal_representative_assertions(guardian_id,child_id,club_id,status,basis,verified_by,verified_at)
    values(p_guardian,p_child,p_club,p_status,p_basis,p_admin,now()) returning id into assertion_id;
  else
    update public.legal_representative_assertions set status=p_status,basis=p_basis,verified_by=p_admin,
      verified_at=case when p_status='verified' then now() else null end where id=assertion_id;
  end if;
  insert into public.legal_representative_events(assertion_id,guardian_id,child_id,club_id,prior_status,new_status,review_basis,reviewed_by)
  values(assertion_id,p_guardian,p_child,p_club,previous,p_status,p_basis,p_admin);
  return assertion_id;
end $$;
revoke all on function public.review_legal_representative(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.review_legal_representative(uuid,uuid,uuid,text,text,uuid) to service_role;

create table public.legal_conflict_resolutions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  beneficiary_id uuid not null,
  club_scope uuid,
  prior_decision_id uuid not null references public.legal_decisions(id) on delete restrict,
  resolved_by uuid not null,
  reason text not null check(length(trim(reason))>=20),
  resolved_at timestamptz not null default now()
);
create index legal_conflict_resolutions_subject_idx on public.legal_conflict_resolutions(document_id,beneficiary_id,resolved_at desc);
alter table public.legal_conflict_resolutions enable row level security;
revoke all on public.legal_conflict_resolutions from anon,authenticated;
create trigger legal_conflict_resolutions_immutable before update or delete on public.legal_conflict_resolutions
  for each row execute function public.legal_prevent_evidence_mutation();

create function public.resolve_legal_withdrawal_conflict(p_document uuid,p_beneficiary uuid,p_club uuid,p_admin uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare current_row public.legal_current_state%rowtype; resolution_id uuid;
begin
  if length(trim(coalesce(p_reason,'')))<20 then raise exception 'Reason required'; end if;
  if not exists(select 1 from public.app_admins a where a.user_id=p_admin) then raise exception 'Platform admin required'; end if;
  perform 1 from public.legal_documents where id=p_document for update;
  if not found then raise exception 'Document missing'; end if;
  select * into current_row from public.legal_current_state
    where document_id=p_document and beneficiary_id=p_beneficiary and scope_key=coalesce(p_club::text,'platform') for update;
  if not found or not current_row.conflict then raise exception 'No withdrawal conflict'; end if;
  insert into public.legal_conflict_resolutions(document_id,beneficiary_id,club_scope,prior_decision_id,resolved_by,reason)
  values(p_document,p_beneficiary,p_club,current_row.decision_id,p_admin,p_reason) returning id into resolution_id;
  update public.legal_current_state set conflict=false
    where document_id=p_document and beneficiary_id=p_beneficiary and scope_key=coalesce(p_club::text,'platform');
  return resolution_id;
end $$;
revoke all on function public.resolve_legal_withdrawal_conflict(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_legal_withdrawal_conflict(uuid,uuid,uuid,uuid,text) to service_role;

create function public.issue_legal_parent_challenge(p_presentation uuid,p_actor uuid,p_email_hash text,p_secret_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare p public.legal_presentations%rowtype; d public.legal_documents%rowtype; latest uuid; recent timestamptz; sends integer; challenge_id uuid;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' or p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid challenge'; end if;
  perform pg_advisory_xact_lock(hashtextextended('legal_parent:'||p_actor::text,0));
  select * into p from public.legal_presentations where id=p_presentation;
  if not found or p.actor_id<>p_actor or p.beneficiary_id=p_actor or p.expires_at<=now()
    or p.authority<>'verified_representative' then raise exception 'Presentation unavailable'; end if;
  select * into d from public.legal_documents where id=p.document_id for update;
  if not d.active or not public.legal_actor_allowed(p_actor,p.beneficiary_id,p.club_id,p.actor_role) then raise exception 'Access changed'; end if;
  select id into latest from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if latest is distinct from p.version_id then raise exception 'Legal version changed'; end if;
  if not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
      and encode(digest(lower(trim(u.email)),'sha256'),'hex')=p_email_hash) then raise exception 'Verified parent email required'; end if;
  select max(created_at),count(*) filter(where created_at>now()-interval '1 hour') into recent,sends
    from public.legal_parent_challenges where actor_id=p_actor;
  if recent>now()-interval '1 minute' or sends>=5 then raise exception 'Challenge rate limited'; end if;
  update public.legal_parent_challenges set used_at=now() where presentation_id=p.id and used_at is null;
  insert into public.legal_parent_challenges(presentation_id,actor_id,beneficiary_id,email_hash,secret_hash,expires_at)
  values(p.id,p_actor,p.beneficiary_id,p_email_hash,p_secret_hash,least(p.expires_at,now()+interval '10 minutes'))
  returning id into challenge_id;
  return challenge_id;
end $$;
revoke all on function public.issue_legal_parent_challenge(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.issue_legal_parent_challenge(uuid,uuid,text,text) to service_role;

-- Presentations and decisions require the published metadata to match the current document.
-- Edits to scope, role, action or rule stay unusable until a new version is published.
create function public.legal_version_matches_document(p_document uuid,p_version uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select (v.snapshot - 'allowed_variables' - 'translations' - 'change_summary') =
    jsonb_build_object('document_key',d.document_key,'kind',d.kind,'purpose_key',d.purpose_key,
      'scope',d.scope,'club_id',d.club_id,'audience_roles',d.audience_roles,'action_kind',d.action_kind,
      'required',d.required,'applicability',d.applicability,'required_locales',d.required_locales)
  from public.legal_versions v join public.legal_documents d on d.id=v.document_id
  where v.id=p_version and d.id=p_document),false);
$$;
revoke all on function public.legal_version_matches_document(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_version_matches_document(uuid,uuid) to service_role;

create or replace function public.present_legal_document(p_document uuid,p_actor uuid,p_beneficiary uuid,p_role text,p_locale text)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype; v public.legal_versions%rowtype; tr jsonb; rendered jsonb; presentation uuid;
begin
  select * into d from public.legal_documents where id=p_document for update;
  if not found or not d.active then raise exception 'Document unavailable'; end if;
  if coalesce(d.applicability->>'rule','')<>'all_members' then raise exception 'Rule engine not configured'; end if;
  if not (p_role=any(d.audience_roles)) or not public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) then raise exception 'Forbidden'; end if;
  if d.kind='parent_authorization' and p_actor=p_beneficiary then raise exception 'Child beneficiary required'; end if;
  if p_actor<>p_beneficiary and d.kind<>'parent_authorization' and d.kind<>'specific_consent' then raise exception 'Wrong beneficiary'; end if;
  select * into v from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if not found then raise exception 'No published version'; end if;
  if public.legal_version_matches_document(d.id,v.id) is not true then raise exception 'Published metadata changed'; end if;
  tr:=v.snapshot->'translations'->p_locale;
  if tr is null or tr->>'status'<>'approved' then raise exception 'Locale unavailable'; end if;
  if jsonb_array_length(coalesce(v.snapshot->'allowed_variables','[]'::jsonb))>0 then raise exception 'Personalized template requires reviewed renderer'; end if;
  rendered:=jsonb_build_object('document_id',d.id,'version_id',v.id,'version_number',v.version_number,
    'kind',d.kind,'purpose_key',d.purpose_key,'scope',d.scope,'club_id',d.club_id,'action_kind',d.action_kind,
    'locale',p_locale,'title',tr->>'title','body',tr->>'body','action_label',tr->>'action_label',
    'notice_version_ids','[]'::jsonb);
  insert into public.legal_presentations(actor_id,beneficiary_id,actor_role,authority,document_id,version_id,club_id,locale,rendered_snapshot,rendered_sha256)
  values(p_actor,p_beneficiary,p_role,case when p_actor=p_beneficiary then 'self' else 'verified_representative' end,
    d.id,v.id,d.club_id,p_locale,rendered,encode(digest(rendered::text,'sha256'),'hex')) returning id into presentation;
  return presentation;
end $$;
revoke all on function public.present_legal_document(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.present_legal_document(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.decide_legal_document(p_presentation uuid,p_actor uuid,p_decision text,p_key uuid,p_parent_code text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare p public.legal_presentations%rowtype; d public.legal_documents%rowtype; latest uuid; previous public.legal_current_state%rowtype;
  challenge public.legal_parent_challenges%rowtype; event_id uuid; expected text;
begin
  select id into event_id from public.legal_decisions where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if not exists(select 1 from public.legal_decisions where id=event_id and presentation_id=p_presentation and decision=p_decision) then
      raise exception 'Idempotency key reused for another decision';
    end if;
    return event_id;
  end if;
  select * into p from public.legal_presentations where id=p_presentation;
  if not found or p.actor_id<>p_actor or p.expires_at<now() then raise exception 'Presentation expired or forbidden'; end if;
  select * into d from public.legal_documents where id=p.document_id for update;
  if coalesce(d.applicability->>'rule','')<>'all_members' then raise exception 'Rule engine not configured'; end if;
  if not d.active or not public.legal_actor_allowed(p_actor,p.beneficiary_id,p.club_id,p.actor_role) then raise exception 'Access changed'; end if;
  select id into event_id from public.legal_decisions where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if not exists(select 1 from public.legal_decisions where id=event_id and presentation_id=p_presentation and decision=p_decision) then
      raise exception 'Idempotency key reused for another decision';
    end if;
    return event_id;
  end if;
  select id into latest from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if latest is distinct from p.version_id then raise exception 'Legal version changed'; end if;
  if public.legal_version_matches_document(d.id,p.version_id) is not true then raise exception 'Published metadata changed'; end if;
  if p.rendered_sha256<>encode(digest(p.rendered_snapshot::text,'sha256'),'hex') then raise exception 'Presentation integrity failed'; end if;
  if p_decision not in ('accepted','acknowledged','authorized','consented','refused','withdrawn') then raise exception 'Invalid decision'; end if;
  if p_decision='withdrawn' and d.kind<>'specific_consent' then raise exception 'Not withdrawable here'; end if;
  if p_decision='accepted' and d.action_kind<>'accept' or p_decision='acknowledged' and d.action_kind not in ('acknowledge','read')
     or p_decision='authorized' and d.action_kind<>'authorize' or p_decision='consented' and d.action_kind<>'consent'
  then raise exception 'Wrong action'; end if;
  if p.actor_id<>p.beneficiary_id and p_decision not in ('refused','withdrawn') then
    select * into challenge from public.legal_parent_challenges where presentation_id=p.id and actor_id=p_actor
      order by created_at desc limit 1 for update;
    if not found or challenge.used_at is not null or challenge.expires_at<now() or challenge.attempts>=5 then raise exception 'Confirmation required'; end if;
    update public.legal_parent_challenges set attempts=attempts+1 where id=challenge.id;
    expected:=encode(digest(coalesce(p_parent_code,''),'sha256'),'hex');
    if expected<>challenge.secret_hash then return null; end if;
    if not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
      and encode(digest(lower(trim(u.email)),'sha256'),'hex')=challenge.email_hash) then raise exception 'Parent email changed'; end if;
    update public.legal_parent_challenges set used_at=now() where id=challenge.id;
    challenge.used_at:=now();
  end if;
  select * into previous from public.legal_current_state where document_id=d.id and beneficiary_id=p.beneficiary_id
    and scope_key=coalesce(p.club_id::text,'platform') for update;
  if found and previous.conflict and p_decision in ('accepted','authorized','consented') then raise exception 'Withdrawal conflict requires review'; end if;
  insert into public.legal_decisions(presentation_id,actor_id,beneficiary_id,document_id,version_id,club_id,
    decision,rendered_snapshot,rendered_sha256,authority_snapshot,idempotency_key)
  values(p.id,p_actor,p.beneficiary_id,d.id,p.version_id,p.club_id,p_decision,p.rendered_snapshot,p.rendered_sha256,
    jsonb_build_object('role',p.actor_role,'authority',p.authority,'parent_email_confirmed',challenge.used_at is not null),p_key)
  returning id into event_id;
  insert into public.legal_current_state(document_id,beneficiary_id,club_scope,version_id,decision_id,decision,decided_at,conflict)
  values(d.id,p.beneficiary_id,p.club_id,p.version_id,event_id,p_decision,now(),p_decision='withdrawn')
  on conflict(document_id,beneficiary_id,scope_key) do update set version_id=excluded.version_id,decision_id=excluded.decision_id,
    decision=excluded.decision,decided_at=excluded.decided_at,
    conflict=case when excluded.decision='withdrawn' then true else legal_current_state.conflict end;
  return event_id;
end $$;
revoke all on function public.decide_legal_document(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.decide_legal_document(uuid,uuid,text,uuid,text) to service_role;
