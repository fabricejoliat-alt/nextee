-- Prepared for TEST first. Applying this migration does not activate a document
-- or the enforcement gate. The Admin controls below are service-role only.
begin;

do $$ begin
  if (select enabled from public.legal_enforcement_control where singleton) is distinct from false then
    raise exception 'Expected inactive legal enforcement';
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.legal_enforcement_control'::regclass
      and conname='legal_enforcement_control_inactive'
  ) then raise exception 'Expected inactive control constraint'; end if;
end $$;

alter table public.legal_enforcement_control
  drop constraint legal_enforcement_control_inactive;

create table public.legal_activation_events (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('document','enforcement')),
  document_id uuid references public.legal_documents(id) on delete restrict,
  previous_enabled boolean not null,
  enabled boolean not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  check ((target='document' and document_id is not null) or
         (target='enforcement' and document_id is null))
);
create index legal_activation_events_created_idx on public.legal_activation_events(created_at desc);
alter table public.legal_activation_events enable row level security;
revoke all on public.legal_activation_events from public,anon,authenticated;
grant select,insert on public.legal_activation_events to service_role;
create trigger legal_activation_events_immutable before update or delete
  on public.legal_activation_events for each row execute function public.legal_prevent_evidence_mutation();

-- Applicability is a technical audience rule. This operation records its
-- configuration without claiming that a legal professional reviewed it.
create function public.configure_legal_audience(
  p_document uuid, p_expected jsonb, p_actor uuid
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.legal_documents%rowtype;
begin
  if not exists(select 1 from public.app_admins where user_id=p_actor) then
    raise exception 'Platform admin required';
  end if;
  select * into d from public.legal_documents where id=p_document for update;
  if not found then raise exception 'Document missing'; end if;
  if d.active then raise exception 'Deactivate the document before changing its audience'; end if;
  if d.applicability is distinct from p_expected then raise exception 'Audience changed; reload'; end if;
  if d.applicability->>'status'='approved' and d.applicability->>'rule'='all_members' then return; end if;
  perform set_config('app.legal_note','Audience configured by platform admin; no legal review',true);
  update public.legal_documents
    set applicability='{"status":"approved","rule":"all_members","configuration_method":"admin_audience_selection"}'::jsonb
    where id=p_document;
end $$;
revoke all on function public.configure_legal_audience(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.configure_legal_audience(uuid,jsonb,uuid) to service_role;

-- Preserve the existing publication/translation/template checks. Only the
-- separate legal-review attestation is removed.
create or replace function public.publish_legal_draft(p_document_id uuid, p_publisher uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype; dr public.legal_drafts%rowtype; loc text; tr jsonb; n integer; v uuid; snap jsonb;
  source_variables text[]; translated_variables text[];
begin
  select * into d from public.legal_documents where id=p_document_id for update;
  if not found then raise exception 'Document missing'; end if;
  select * into dr from public.legal_drafts where document_id=p_document_id for update;
  if not found or length(trim(dr.change_summary))=0 then raise exception 'Change summary required'; end if;
  if d.applicability->>'status' is distinct from 'approved'
    or d.applicability->>'rule' is distinct from 'all_members' then
    raise exception 'Audience rule not configured';
  end if;
  if exists(select 1 from unnest(dr.allowed_variables) as t(variable)
    where variable not in ('child_name','club_name','user_name')) then raise exception 'Unsupported variable'; end if;
  if not ('fr'=any(d.required_locales)) then raise exception 'French source required'; end if;
  source_variables:=public.legal_template_variables(
    coalesce(dr.translations->'fr'->>'title','')||coalesce(dr.translations->'fr'->>'body','')||coalesce(dr.translations->'fr'->>'action_label',''));
  foreach loc in array d.required_locales loop
    tr:=dr.translations->loc;
    if loc not in ('fr','en','de','it') or tr is null or tr->>'status'<>'approved'
       or coalesce((tr->>'source_revision')::integer,-1)<>dr.source_revision
       or length(trim(coalesce(tr->>'title','')))=0 or length(trim(coalesce(tr->>'body','')))=0
       or (d.action_kind<>'read' and length(trim(coalesce(tr->>'action_label','')))=0)
    then raise exception 'Missing or unapproved translation: %',loc; end if;
    if not public.legal_template_is_valid(coalesce(tr->>'title',''),dr.allowed_variables)
      or not public.legal_template_is_valid(coalesce(tr->>'body',''),dr.allowed_variables)
      or not public.legal_template_is_valid(coalesce(tr->>'action_label',''),dr.allowed_variables)
    then raise exception 'Invalid placeholder: %',loc; end if;
    translated_variables:=public.legal_template_variables(coalesce(tr->>'title','')||coalesce(tr->>'body','')||coalesce(tr->>'action_label',''));
    if translated_variables<>source_variables then raise exception 'Placeholder mismatch: %',loc; end if;
  end loop;
  select coalesce(max(version_number),0)+1 into n from public.legal_versions where document_id=d.id;
  snap:=jsonb_build_object('document_key',d.document_key,'kind',d.kind,'purpose_key',d.purpose_key,
    'scope',d.scope,'club_id',d.club_id,'audience_roles',d.audience_roles,'action_kind',d.action_kind,
    'required',d.required,'applicability',d.applicability,'required_locales',d.required_locales,
    'allowed_variables',dr.allowed_variables,'translations',dr.translations,'change_summary',dr.change_summary);
  insert into public.legal_versions(document_id,version_number,snapshot,content_sha256,published_by)
  values(d.id,n,snap,encode(extensions.digest(snap::text,'sha256'),'hex'),p_publisher) returning id into v;
  return v;
end $$;

create function public.legal_assert_enforcement_ready()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.legal_documents%rowtype; v public.legal_versions%rowtype; loc text;
begin
  if not exists(select 1 from public.legal_documents
      where active and required and scope='platform' and kind='terms' and document_key like 'activitee_%')
    or not exists(select 1 from public.legal_documents
      where active and required and scope='platform' and kind='privacy' and document_key like 'activitee_%') then
    raise exception 'Active platform terms and privacy documents are required';
  end if;
  if exists(select 1 from public.legal_documents
      where required and document_key like 'activitee_%' and not active) then
    raise exception 'All required ActiviTee documents must be active';
  end if;
  for d in select * from public.legal_documents where active loop
    if d.applicability->>'status' is distinct from 'approved'
      or d.applicability->>'rule' is distinct from 'all_members' then
      raise exception 'Active audience rule unsupported: %',d.document_key;
    end if;
    select * into v from public.legal_versions where document_id=d.id order by version_number desc limit 1;
    if not found or public.legal_version_matches_document(d.id,v.id) is not true then
      raise exception 'Published version missing or changed: %',d.document_key;
    end if;
    foreach loc in array d.required_locales loop
      if v.snapshot->'translations'->loc->>'status' is distinct from 'approved' then
        raise exception 'Published language unavailable: % / %',d.document_key,loc;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.legal_assert_enforcement_ready() from public,anon,authenticated;
grant execute on function public.legal_assert_enforcement_ready() to service_role;

create function public.set_legal_activation(
  p_target text, p_document uuid, p_enabled boolean, p_expected boolean,
  p_expected_version uuid, p_actor uuid
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.legal_documents%rowtype; v uuid; current_enabled boolean;
begin
  if not exists(select 1 from public.app_admins where user_id=p_actor) then
    raise exception 'Platform admin required';
  end if;
  if p_enabled is null or p_expected is null then raise exception 'Expected state required'; end if;
  -- Serialize document and global switches on the same row.
  select enabled into current_enabled from public.legal_enforcement_control where singleton for update;
  if not found then raise exception 'Legal control missing'; end if;
  if p_target='document' then
    if p_document is null then raise exception 'Document required'; end if;
    select * into d from public.legal_documents where id=p_document for update;
    if not found then raise exception 'Document missing'; end if;
    if d.active is distinct from p_expected then raise exception 'Document state changed; reload'; end if;
    if d.active=p_enabled then return; end if;
    if p_enabled then
      select id into v from public.legal_versions where document_id=d.id order by version_number desc limit 1;
      if v is null or v is distinct from p_expected_version
        or public.legal_version_matches_document(d.id,v) is not true then
        raise exception 'Publish and review the latest version first';
      end if;
      if d.applicability->>'status' is distinct from 'approved'
        or d.applicability->>'rule' is distinct from 'all_members' then
        raise exception 'Configure the audience first';
      end if;
    end if;
    update public.legal_documents set active=p_enabled where id=d.id;
    if current_enabled then
      perform public.legal_assert_enforcement_ready();
    end if;
    insert into public.legal_activation_events(target,document_id,previous_enabled,enabled,actor_id)
      values('document',d.id,d.active,p_enabled,p_actor);
  elsif p_target='enforcement' then
    if p_document is not null then raise exception 'Unexpected document'; end if;
    if current_enabled is distinct from p_expected then raise exception 'Control state changed; reload'; end if;
    if current_enabled=p_enabled then return; end if;
    if p_enabled then perform public.legal_assert_enforcement_ready(); end if;
    update public.legal_enforcement_control set enabled=p_enabled,updated_at=now() where singleton;
    insert into public.legal_activation_events(target,previous_enabled,enabled,actor_id)
      values('enforcement',current_enabled,p_enabled,p_actor);
  else raise exception 'Invalid activation target'; end if;
end $$;
revoke all on function public.set_legal_activation(text,uuid,boolean,boolean,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_legal_activation(text,uuid,boolean,boolean,uuid,uuid) to service_role;

commit;
