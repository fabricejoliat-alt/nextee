-- Unify the parent's access authorization with the published, versioned document.
-- No publication, activation, representative promotion, or existing consent backfill.
begin;

alter table public.legal_presentations drop constraint legal_presentations_authority_check;
alter table public.legal_presentations add constraint legal_presentations_authority_check
  check (authority in ('self','verified_representative','club_linked_parent'));

create function public.legal_document_actor_allowed(p_document uuid,p_actor uuid,p_beneficiary uuid,p_role text)
returns boolean language sql stable security definer set search_path=public as $$
  select case when d.kind='parent_authorization' and d.purpose_key='service.parent_authorization' then
    p_actor<>p_beneficiary and p_role='parent' and d.scope='club' and d.club_id is not null
    and exists(select 1 from public.club_members m where m.user_id=p_actor and m.club_id=d.club_id
      and m.role='parent' and m.is_active)
    and exists(select 1 from public.club_members m where m.user_id=p_beneficiary and m.club_id=d.club_id
      and m.role='player' and m.is_active and m.player_consent_status is distinct from 'adult')
    and exists(select 1 from public.player_guardians g where g.guardian_user_id=p_actor and g.player_id=p_beneficiary
      and coalesce(g.can_view,true) and g.can_edit
      and (g.relation in ('father','mother','legal_guardian') or public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role)))
    and not exists(select 1 from public.legal_representative_assertions a where a.guardian_id=p_actor
      and a.child_id=p_beneficiary and a.club_id=d.club_id and a.status='revoked')
  else public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) end
  from public.legal_documents d where d.id=p_document;
$$;
revoke all on function public.legal_document_actor_allowed(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.legal_document_actor_allowed(uuid,uuid,uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.present_legal_document(p_document uuid, p_actor uuid, p_beneficiary uuid, p_role text, p_locale text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.legal_documents%rowtype; v public.legal_versions%rowtype; tr jsonb; rendered jsonb; presentation uuid;
  variable text; value text; rendered_title text; rendered_body text; rendered_action text; allowed text[];
begin
  select * into d from public.legal_documents where id=p_document for update;
  if not found or not d.active then raise exception 'Document unavailable'; end if;
  if coalesce(d.applicability->>'rule','')<>'all_members' then raise exception 'Rule engine not configured'; end if;
  if not (p_role=any(d.audience_roles)) or not public.legal_document_actor_allowed(d.id,p_actor,p_beneficiary,p_role) then raise exception 'Forbidden'; end if;
  if d.kind='parent_authorization' and p_actor=p_beneficiary then raise exception 'Child beneficiary required'; end if;
  if p_actor<>p_beneficiary and d.kind<>'parent_authorization' and d.kind<>'specific_consent' then raise exception 'Wrong beneficiary'; end if;
  select * into v from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if not found then raise exception 'No published version'; end if;
  if public.legal_version_matches_document(d.id,v.id) is not true then raise exception 'Published metadata changed'; end if;
  tr:=v.snapshot->'translations'->p_locale;
  if tr is null or tr->>'status'<>'approved' then raise exception 'Locale unavailable'; end if;
  rendered_title:=tr->>'title'; rendered_body:=tr->>'body'; rendered_action:=tr->>'action_label';
  allowed:=array(select jsonb_array_elements_text(v.snapshot->'allowed_variables'));
  if not public.legal_template_is_valid(coalesce(rendered_title,''),allowed)
    or not public.legal_template_is_valid(coalesce(rendered_body,''),allowed)
    or not public.legal_template_is_valid(coalesce(rendered_action,''),allowed)
  then raise exception 'Published template invalid'; end if;
  foreach variable in array array['child_name','club_name','user_name'] loop
    if variable=any(public.legal_template_variables(rendered_title||rendered_body||coalesce(rendered_action,''))) then
      case variable
        when 'child_name' then
          if p_actor=p_beneficiary then raise exception 'Child variable requires a child beneficiary'; end if;
          select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into value from public.profiles where id=p_beneficiary;
        when 'club_name' then
          if d.club_id is null then raise exception 'Club variable requires a club document'; end if;
          select nullif(btrim(name),'') into value from public.clubs where id=d.club_id;
        when 'user_name' then
          select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into value from public.profiles where id=p_actor;
      end case;
      if value is null or position('{{' in value)>0 or position('}}' in value)>0 then raise exception 'Template value unavailable'; end if;
      rendered_title:=replace(rendered_title,'{{'||variable||'}}',value);
      rendered_body:=replace(rendered_body,'{{'||variable||'}}',value);
      rendered_action:=replace(rendered_action,'{{'||variable||'}}',value);
    end if;
  end loop;
  rendered:=jsonb_build_object('document_id',d.id,'version_id',v.id,'version_number',v.version_number,
    'kind',d.kind,'purpose_key',d.purpose_key,'scope',d.scope,'club_id',d.club_id,'action_kind',d.action_kind,
    'locale',p_locale,'title',rendered_title,'body',rendered_body,'action_label',rendered_action,
    'notice_version_ids','[]'::jsonb);
  insert into public.legal_presentations(actor_id,beneficiary_id,actor_role,authority,document_id,version_id,club_id,locale,rendered_snapshot,rendered_sha256)
  values(p_actor,p_beneficiary,p_role,case when p_actor=p_beneficiary then 'self'
    when public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) then 'verified_representative'
    else 'club_linked_parent' end,
    d.id,v.id,d.club_id,p_locale,rendered,encode(extensions.digest(rendered::text,'sha256'),'hex')) returning id into presentation;
  return presentation;
end $function$
;
CREATE OR REPLACE FUNCTION public.decide_legal_document(p_presentation uuid, p_actor uuid, p_decision text, p_key uuid, p_parent_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not d.active or not public.legal_document_actor_allowed(d.id,p_actor,p.beneficiary_id,p.actor_role) then raise exception 'Access changed'; end if;
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
  if p.rendered_sha256<>encode(extensions.digest(p.rendered_snapshot::text,'sha256'),'hex') then raise exception 'Presentation integrity failed'; end if;
  if p_decision not in ('accepted','acknowledged','authorized','consented','refused','withdrawn') then raise exception 'Invalid decision'; end if;
  if p_decision='withdrawn' and d.kind not in ('specific_consent','parent_authorization') then raise exception 'Not withdrawable here'; end if;
  if p_decision='accepted' and d.action_kind<>'accept' or p_decision='acknowledged' and d.action_kind not in ('acknowledge','read')
     or p_decision='authorized' and d.action_kind<>'authorize' or p_decision='consented' and d.action_kind<>'consent'
  then raise exception 'Wrong action'; end if;
  if p.actor_id<>p.beneficiary_id and p_decision not in ('refused','withdrawn') then
    select * into challenge from public.legal_parent_challenges where presentation_id=p.id and actor_id=p_actor
      order by created_at desc limit 1 for update;
    if not found or challenge.used_at is not null or challenge.expires_at<now() or challenge.attempts>=5 then raise exception 'Confirmation required'; end if;
    update public.legal_parent_challenges set attempts=attempts+1 where id=challenge.id;
    expected:=encode(extensions.digest(coalesce(p_parent_code,''),'sha256'),'hex');
    if expected<>challenge.secret_hash then return null; end if;
    if not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
      and encode(extensions.digest(lower(trim(u.email)),'sha256'),'hex')=challenge.email_hash) then raise exception 'Parent email changed'; end if;
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
  values(d.id,p.beneficiary_id,p.club_id,p.version_id,event_id,p_decision,now(),p_decision='withdrawn' or (d.kind='parent_authorization' and p_decision='refused'))
  on conflict(document_id,beneficiary_id,scope_key) do update set version_id=excluded.version_id,decision_id=excluded.decision_id,
    decision=excluded.decision,decided_at=excluded.decided_at,
    conflict=case when excluded.conflict then true else legal_current_state.conflict end;
  return event_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.issue_legal_parent_challenge(p_presentation uuid, p_actor uuid, p_email_hash text, p_secret_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.legal_presentations%rowtype; d public.legal_documents%rowtype; latest uuid; recent timestamptz; sends integer; challenge_id uuid;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' or p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid challenge'; end if;
  perform pg_advisory_xact_lock(hashtextextended('legal_parent:'||p_actor::text,0));
  select * into p from public.legal_presentations where id=p_presentation;
  if not found or p.actor_id<>p_actor or p.beneficiary_id=p_actor or p.expires_at<=now()
    or p.authority not in ('verified_representative','club_linked_parent') then raise exception 'Presentation unavailable'; end if;
  select * into d from public.legal_documents where id=p.document_id for update;
  if not d.active or not public.legal_document_actor_allowed(d.id,p_actor,p.beneficiary_id,p.actor_role) then raise exception 'Access changed'; end if;
  select id into latest from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if latest is distinct from p.version_id then raise exception 'Legal version changed'; end if;
  if not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
      and encode(extensions.digest(lower(trim(u.email)),'sha256'),'hex')=p_email_hash) then raise exception 'Verified parent email required'; end if;
  select max(created_at),count(*) filter(where created_at>now()-interval '1 hour') into recent,sends
    from public.legal_parent_challenges where actor_id=p_actor;
  if recent>now()-interval '1 minute' or sends>=5 then raise exception 'Challenge rate limited'; end if;
  update public.legal_parent_challenges set used_at=now() where presentation_id=p.id and used_at is null;
  insert into public.legal_parent_challenges(presentation_id,actor_id,beneficiary_id,email_hash,secret_hash,expires_at)
  values(p.id,p_actor,p.beneficiary_id,p_email_hash,p_secret_hash,least(p.expires_at,now()+interval '10 minutes'))
  returning id into challenge_id;
  return challenge_id;
end $function$
;

-- The legal decision and its legacy access projection commit together. Never
-- call the former all-clubs grant RPC after a per-club legal decision.
create function public.sync_parent_authorization_access()
returns trigger language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype; e public.legal_decisions%rowtype; next_status text; signer text;
begin
  select * into d from public.legal_documents where id=new.document_id;
  if d.kind<>'parent_authorization' or d.purpose_key<>'service.parent_authorization' then return new; end if;
  select * into e from public.legal_decisions where id=new.decision_id;
  if e.source<>'user_flow' or e.actor_id=e.beneficiary_id or e.club_id is distinct from d.club_id
    or e.document_id<>d.id or e.beneficiary_id<>new.beneficiary_id then raise exception 'Invalid parent access decision'; end if;
  if new.decision='authorized' and not new.conflict then
    if (e.authority_snapshot->>'parent_email_confirmed')::boolean is not true
      or public.legal_document_actor_allowed(d.id,e.actor_id,e.beneficiary_id,'parent') is not true
      or e.version_id is distinct from (select id from public.legal_versions where document_id=d.id order by version_number desc limit 1)
    then raise exception 'Parent access confirmation required'; end if;
    next_status:='granted';
  else next_status:='refused'; end if;
  perform 1 from public.club_members where user_id=e.beneficiary_id and club_id=e.club_id
    and role='player' and is_active for update;
  if not found then raise exception 'Child membership changed'; end if;
  select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into signer from public.profiles where id=e.actor_id;
  update public.club_members set player_consent_status=next_status
    where user_id=e.beneficiary_id and club_id=e.club_id and role='player' and is_active;
  insert into public.player_consents(club_id,player_user_id,status,decided_at,signer_guardian_user_id,
    signer_name,source,consent_version,updated_by,updated_at)
  values(e.club_id,e.beneficiary_id,next_status,e.decided_at,e.actor_id,signer,'parent_portal','legal:'||e.version_id::text,e.actor_id,now())
  on conflict(club_id,player_user_id) do update set status=excluded.status,decided_at=excluded.decided_at,
    signer_guardian_user_id=excluded.signer_guardian_user_id,signer_name=excluded.signer_name,source=excluded.source,
    consent_version=excluded.consent_version,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  -- A conflict resolution changes the projection without inventing a new decision.
  if tg_op='INSERT' or old.decision_id is distinct from new.decision_id then
    insert into public.player_consent_history(club_id,player_user_id,status,decided_at,signer_guardian_user_id,
      signer_name,source,consent_version,changed_by)
    values(e.club_id,e.beneficiary_id,next_status,e.decided_at,e.actor_id,signer,'parent_portal','legal:'||e.version_id::text,e.actor_id);
  end if;
  return new;
end;
$$;
revoke all on function public.sync_parent_authorization_access() from public,anon,authenticated;
create trigger sync_parent_authorization_access after insert or update on public.legal_current_state
for each row execute function public.sync_parent_authorization_access();

-- Future publication/activation of a parental document requires a fresh choice.
-- Preserve adults and refusals; previous evidence remains immutable.
create function public.reset_parent_authorization_access()
returns trigger language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype;
begin
  if tg_table_name='legal_versions' then
    select * into d from public.legal_documents where id=new.document_id;
  else d:=new; end if;
  if not d.active or d.kind<>'parent_authorization' or d.purpose_key<>'service.parent_authorization' then return new; end if;
  update public.club_members set player_consent_status='pending'
    where club_id=d.club_id and role='player' and is_active and player_consent_status='granted';
  update public.player_consents set status='pending',updated_at=now()
    where club_id=d.club_id and status='granted';
  return new;
end;
$$;
revoke all on function public.reset_parent_authorization_access() from public,anon,authenticated;
create trigger parent_authorization_new_version after insert on public.legal_versions
for each row execute function public.reset_parent_authorization_access();
create trigger parent_authorization_activated after update of active on public.legal_documents
for each row when (new.active and not old.active) execute function public.reset_parent_authorization_access();

-- Old clients must enter the full document flow and cannot grant all clubs.
create or replace function public.grant_player_consent_transactional(
  p_player_id uuid,p_guardian_user_id uuid,p_signer_name text default null,p_consent_version text default 'activitee-v1'
) returns jsonb language plpgsql security definer set search_path=public as $$
begin raise exception 'VERSIONED_PARENT_AUTHORIZATION_REQUIRED'; end;
$$;
revoke all on function public.grant_player_consent_transactional(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.grant_player_consent_transactional(uuid,uuid,text,text) to service_role;

commit;
