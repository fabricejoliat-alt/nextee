-- Additive, inactive legal document registry. Apply only after the TEST preflight in docs/legal/README.md.
create extension if not exists pgcrypto;

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_key text not null unique check (document_key ~ '^[a-z0-9_-]+$'),
  kind text not null check (kind in ('terms','privacy','parent_authorization','specific_consent','junior_notice')),
  purpose_key text not null,
  scope text not null check (scope in ('platform','club')),
  club_id uuid references public.clubs(id) on delete restrict,
  audience_roles text[] not null default '{}',
  action_kind text not null check (action_kind in ('accept','acknowledge','authorize','consent','read')),
  required boolean not null default false,
  active boolean not null default false,
  applicability jsonb not null default '{"status":"unapproved"}'::jsonb,
  required_locales text[] not null default '{fr,en,de,it}',
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((scope='platform' and club_id is null) or (scope='club' and club_id is not null)),
  check (array_length(required_locales,1) > 0),
  check (not active or coalesce(applicability->>'status','')='approved')
);
create index legal_documents_scope_idx on public.legal_documents(scope,club_id,active);
create table public.legal_rule_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  revision integer not null check (revision>0),
  configuration jsonb not null,
  review_note text not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(document_id,revision)
);
-- A rule remains unapproved unless a reviewed revision is recorded and copied to the document.
create function public.record_legal_rule_revision() returns trigger language plpgsql as $$
declare next_revision integer; reviewer uuid; note text;
begin
  if tg_op='INSERT' then
    insert into public.legal_rule_revisions(document_id,revision,configuration,review_note)
    values(new.id,1,new.applicability,'Unapproved initial rule');
    return new;
  end if;
  if new.applicability is distinct from old.applicability then
    select coalesce(max(revision),0)+1 into next_revision from public.legal_rule_revisions where document_id=new.id;
    reviewer:=nullif(current_setting('app.legal_reviewer',true),'')::uuid;
    note:=coalesce(nullif(current_setting('app.legal_note',true),''),'Unreviewed rule change');
    insert into public.legal_rule_revisions(document_id,revision,configuration,review_note,reviewed_by,reviewed_at)
    values(new.id,next_revision,new.applicability,note,reviewer,case when reviewer is null then null else now() end);
  end if;
  return new;
end $$;
create trigger legal_rule_revision_after_insert after insert on public.legal_documents
  for each row execute function public.record_legal_rule_revision();
create trigger legal_rule_revision_after_update after update of applicability on public.legal_documents
  for each row execute function public.record_legal_rule_revision();

create function public.review_legal_applicability(p_document uuid,p_reviewer uuid,p_configuration jsonb,p_note text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if length(trim(p_note))<20 or p_configuration->>'status'<>'approved' then raise exception 'Reviewed rationale required'; end if;
  perform set_config('app.legal_reviewer',p_reviewer::text,true);
  perform set_config('app.legal_note',p_note,true);
  update public.legal_documents set applicability=p_configuration where id=p_document and applicability is distinct from p_configuration;
  if not found then raise exception 'Missing document or unchanged rule'; end if;
end $$;
revoke all on function public.review_legal_applicability(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.review_legal_applicability(uuid,uuid,jsonb,text) to service_role;

create table public.legal_drafts (
  document_id uuid primary key references public.legal_documents(id) on delete cascade,
  source_revision integer not null default 1 check (source_revision>0),
  change_summary text not null default '',
  allowed_variables text[] not null default '{}',
  translations jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
-- Translation shape: {fr:{title,body,action_label,status,source_revision},...}.
-- Editing the French source increments source_revision and invalidates other approvals in the application RPC.
create table public.legal_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  version_number integer not null check (version_number>0),
  snapshot jsonb not null,
  content_sha256 text not null,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  unique(document_id,version_number)
);
create index legal_versions_current_idx on public.legal_versions(document_id,published_at desc);

create table public.legal_presentations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  beneficiary_id uuid not null,
  actor_role text not null,
  authority text not null check (authority in ('self','verified_representative')),
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  version_id uuid not null references public.legal_versions(id) on delete restrict,
  club_id uuid,
  locale text not null check (locale in ('fr','en','de','it')),
  rendered_snapshot jsonb not null,
  rendered_sha256 text not null,
  presented_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 minutes')
);
create index legal_presentations_actor_idx on public.legal_presentations(actor_id,presented_at desc);

create table public.legal_decisions (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.legal_presentations(id) on delete restrict,
  actor_id uuid not null,
  beneficiary_id uuid not null,
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  version_id uuid not null references public.legal_versions(id) on delete restrict,
  club_id uuid,
  decision text not null check (decision in ('accepted','acknowledged','authorized','consented','refused','withdrawn')),
  source text not null default 'user_flow' check (source in ('user_flow','external_record','historical_import')),
  rendered_snapshot jsonb not null,
  rendered_sha256 text not null,
  authority_snapshot jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique(actor_id,idempotency_key)
);
create index legal_decisions_subject_idx on public.legal_decisions(beneficiary_id,document_id,decided_at desc);
create table public.legal_current_state (
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  beneficiary_id uuid not null,
  club_scope uuid,
  scope_key text generated always as (coalesce(club_scope::text,'platform')) stored,
  version_id uuid not null references public.legal_versions(id) on delete restrict,
  decision_id uuid not null references public.legal_decisions(id) on delete restrict,
  decision text not null,
  decided_at timestamptz not null,
  conflict boolean not null default false,
  primary key(document_id,beneficiary_id,scope_key)
);

-- A guardian link is access permission, not proof of legal representation.
create table public.legal_representative_assertions (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null,
  child_id uuid not null,
  club_id uuid not null references public.clubs(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','verified','revoked')),
  basis text not null default 'unverified',
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(guardian_id,child_id,club_id)
);
create table public.legal_parent_challenges (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.legal_presentations(id) on delete restrict,
  actor_id uuid not null,
  beneficiary_id uuid not null,
  email_hash text not null,
  secret_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index legal_parent_challenges_actor_idx on public.legal_parent_challenges(actor_id,created_at desc);

create table public.legal_data_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid,
  contact_email text not null,
  request_kind text not null check(request_kind in ('access','rectification','erasure','other')),
  description text not null default '',
  status text not null default 'received' check(status in ('received','identity_check','in_review','resolved','rejected')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create table public.legal_data_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.legal_data_requests(id) on delete restrict,
  actor_id uuid not null,
  from_status text not null,
  to_status text not null,
  note text not null,
  recorded_at timestamptz not null default now()
);
create function public.review_legal_data_request(p_request uuid,p_actor uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare previous text;
begin
  if p_status not in ('identity_check','in_review','resolved','rejected') or length(trim(p_note))<10 then raise exception 'Invalid review'; end if;
  select status into previous from public.legal_data_requests where id=p_request for update;
  if not found then raise exception 'Request missing'; end if;
  update public.legal_data_requests set status=p_status,
    closed_at=case when p_status in ('resolved','rejected') then now() else null end where id=p_request;
  insert into public.legal_data_request_events(request_id,actor_id,from_status,to_status,note)
  values(p_request,p_actor,previous,p_status,p_note);
end $$;
revoke all on function public.review_legal_data_request(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_legal_data_request(uuid,uuid,text,text) to service_role;

create table public.legal_legacy_references (
  legacy_history_id uuid primary key,
  source text not null,
  classification text not null default 'historical_unverified',
  imported_at timestamptz not null default now(),
  check(classification='historical_unverified')
);
insert into public.legal_legacy_references(legacy_history_id,source)
select id,source from public.player_consent_history on conflict do nothing;

create table public.legal_legacy_current_refs (
  club_id uuid not null,
  player_user_id uuid not null,
  status_at_import text not null,
  source_at_import text not null,
  version_label_at_import text,
  classification text not null default 'historical_unverified' check(classification='historical_unverified'),
  imported_at timestamptz not null default now(),
  primary key(club_id,player_user_id)
);
insert into public.legal_legacy_current_refs(club_id,player_user_id,status_at_import,source_at_import,version_label_at_import)
select club_id,player_user_id,status,source,consent_version from public.player_consents on conflict do nothing;

-- No direct client table access. Server routes use service role and recheck actor/subject.
do $$ declare t text; begin
  foreach t in array array['legal_documents','legal_rule_revisions','legal_drafts','legal_versions','legal_presentations','legal_decisions','legal_current_state','legal_representative_assertions','legal_parent_challenges','legal_data_requests','legal_data_request_events','legal_legacy_references','legal_legacy_current_refs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;

create function public.legal_prevent_evidence_mutation() returns trigger language plpgsql as $$
begin raise exception 'Published legal evidence is immutable'; end $$;
create trigger legal_data_request_events_immutable before update or delete on public.legal_data_request_events for each row execute function public.legal_prevent_evidence_mutation();
create trigger legal_rule_revisions_immutable before update or delete on public.legal_rule_revisions for each row execute function public.legal_prevent_evidence_mutation();
create trigger legal_versions_immutable before update or delete on public.legal_versions for each row execute function public.legal_prevent_evidence_mutation();
create trigger legal_presentations_immutable before update or delete on public.legal_presentations for each row execute function public.legal_prevent_evidence_mutation();
create trigger legal_decisions_immutable before update or delete on public.legal_decisions for each row execute function public.legal_prevent_evidence_mutation();

-- Publication is serialized against decisions with a document row lock.
create function public.publish_legal_draft(p_document_id uuid,p_publisher uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype; dr public.legal_drafts%rowtype; loc text; tr jsonb; n integer; v uuid; snap jsonb;
begin
  select * into d from public.legal_documents where id=p_document_id for update;
  if not found then raise exception 'Document missing'; end if;
  select * into dr from public.legal_drafts where document_id=p_document_id for update;
  if not found or length(trim(dr.change_summary))=0 then raise exception 'Change summary required'; end if;
  if d.applicability->>'status'<>'approved' or not exists(select 1 from public.legal_rule_revisions rr where rr.document_id=d.id
    and rr.configuration=d.applicability and rr.reviewed_by is not null and rr.reviewed_at is not null
    and rr.revision=(select max(revision) from public.legal_rule_revisions where document_id=d.id)) then raise exception 'Applicability unapproved'; end if;
  foreach loc in array d.required_locales loop
    tr:=dr.translations->loc;
    if loc not in ('fr','en','de','it') or tr is null or tr->>'status'<>'approved'
       or coalesce((tr->>'source_revision')::integer,-1)<>dr.source_revision
       or length(trim(coalesce(tr->>'title','')))=0 or length(trim(coalesce(tr->>'body','')))=0
       or (d.action_kind<>'read' and length(trim(coalesce(tr->>'action_label','')))=0)
    then raise exception 'Missing or unapproved translation: %',loc; end if;
  end loop;
  select coalesce(max(version_number),0)+1 into n from public.legal_versions where document_id=d.id;
  snap:=jsonb_build_object('document_key',d.document_key,'kind',d.kind,'purpose_key',d.purpose_key,
    'scope',d.scope,'club_id',d.club_id,'audience_roles',d.audience_roles,'action_kind',d.action_kind,
    'required',d.required,'applicability',d.applicability,'required_locales',d.required_locales,
    'allowed_variables',dr.allowed_variables,'translations',dr.translations,'change_summary',dr.change_summary);
  insert into public.legal_versions(document_id,version_number,snapshot,content_sha256,published_by)
  values(d.id,n,snap,encode(digest(snap::text,'sha256'),'hex'),p_publisher) returning id into v;
  return v;
end $$;
revoke all on function public.publish_legal_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_legal_draft(uuid,uuid) to service_role;

-- Retention and legally required erasure require a separately reviewed privileged procedure.
-- Do not add a cascading delete from profiles to the evidence tables.

create function public.legal_actor_allowed(p_actor uuid,p_beneficiary uuid,p_club uuid,p_role text)
returns boolean language sql stable security definer set search_path=public as $$
  select case when p_actor=p_beneficiary then
    (exists(select 1 from public.club_members m where m.user_id=p_actor and m.is_active and m.role::text=p_role
      and (p_club is null or m.club_id=p_club))
     or (p_role='admin' and p_club is null and exists(select 1 from public.app_admins a where a.user_id=p_actor)))
  else
    p_role='parent' and p_club is not null
    and exists(select 1 from public.club_members m where m.user_id=p_actor and m.club_id=p_club and m.role='parent' and m.is_active)
    and exists(select 1 from public.club_members m where m.user_id=p_beneficiary and m.club_id=p_club and m.role='player' and m.is_active)
    and exists(select 1 from public.player_guardians g where g.guardian_user_id=p_actor and g.player_id=p_beneficiary and g.can_edit)
    and exists(select 1 from public.legal_representative_assertions a where a.guardian_id=p_actor and a.child_id=p_beneficiary and a.club_id=p_club and a.status='verified')
  end;
$$;
revoke all on function public.legal_actor_allowed(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.legal_actor_allowed(uuid,uuid,uuid,text) to service_role;

create function public.present_legal_document(p_document uuid,p_actor uuid,p_beneficiary uuid,p_role text,p_locale text)
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

create function public.decide_legal_document(p_presentation uuid,p_actor uuid,p_decision text,p_key uuid,p_parent_code text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare p public.legal_presentations%rowtype; d public.legal_documents%rowtype; latest uuid; previous public.legal_current_state%rowtype;
  challenge public.legal_parent_challenges%rowtype; event_id uuid; expected text;
begin
  select id into event_id from public.legal_decisions where actor_id=p_actor and idempotency_key=p_key;
  if found then return event_id; end if;
  select * into p from public.legal_presentations where id=p_presentation;
  if not found or p.actor_id<>p_actor or p.expires_at<now() then raise exception 'Presentation expired or forbidden'; end if;
  select * into d from public.legal_documents where id=p.document_id for update;
  if coalesce(d.applicability->>'rule','')<>'all_members' then raise exception 'Rule engine not configured'; end if;
  if not d.active or not public.legal_actor_allowed(p_actor,p.beneficiary_id,p.club_id,p.actor_role) then raise exception 'Access changed'; end if;
  select id into event_id from public.legal_decisions where actor_id=p_actor and idempotency_key=p_key;
  if found then return event_id; end if;
  select id into latest from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if latest<>p.version_id then raise exception 'Legal version changed'; end if;
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
  if found and previous.decision='withdrawn' and p_decision in ('accepted','authorized','consented') then raise exception 'Withdrawal conflict requires review'; end if;
  insert into public.legal_decisions(presentation_id,actor_id,beneficiary_id,document_id,version_id,club_id,
    decision,rendered_snapshot,rendered_sha256,authority_snapshot,idempotency_key)
  values(p.id,p_actor,p.beneficiary_id,d.id,p.version_id,p.club_id,p_decision,p.rendered_snapshot,p.rendered_sha256,
    jsonb_build_object('role',p.actor_role,'authority',p.authority,'parent_email_confirmed',challenge.used_at is not null),p_key)
  returning id into event_id;
  insert into public.legal_current_state(document_id,beneficiary_id,club_scope,version_id,decision_id,decision,decided_at,conflict)
  values(d.id,p.beneficiary_id,p.club_id,p.version_id,event_id,p_decision,now(),p_decision='withdrawn')
  on conflict(document_id,beneficiary_id,scope_key) do update set version_id=excluded.version_id,decision_id=excluded.decision_id,
    decision=excluded.decision,decided_at=excluded.decided_at,conflict=excluded.conflict;
  return event_id;
end $$;
revoke all on function public.decide_legal_document(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.decide_legal_document(uuid,uuid,text,uuid,text) to service_role;
