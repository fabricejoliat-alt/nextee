-- Reversible TEST control for parent access authorization only. Default is secure.
-- Apply after 20261107; this migration does not turn off the code requirement.
begin;
create table public.legal_parent_code_control (
  singleton boolean primary key default true check (singleton),
  required boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.legal_parent_code_control(singleton,required) values(true,true);
alter table public.legal_parent_code_control enable row level security;
revoke all on public.legal_parent_code_control from public,anon,authenticated;
grant select,update on public.legal_parent_code_control to service_role;

CREATE OR REPLACE FUNCTION public.decide_legal_document(p_presentation uuid, p_actor uuid, p_decision text, p_key uuid, p_parent_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.legal_presentations%rowtype; d public.legal_documents%rowtype; latest uuid; previous public.legal_current_state%rowtype;
  challenge public.legal_parent_challenges%rowtype; event_id uuid; expected text;
  code_required boolean; parent_email_verified boolean:=false; confirmation_method text:='none';
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
    select required into code_required from public.legal_parent_code_control where singleton;
    if not found then raise exception 'Parent confirmation control unavailable'; end if;
    if d.kind='parent_authorization' and d.purpose_key='service.parent_authorization' and not code_required then
      select exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
        and nullif(btrim(u.email),'') is not null) into parent_email_verified;
      if not parent_email_verified then raise exception 'Verified parent email required'; end if;
      confirmation_method:='temporarily_waived';
    else
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
    parent_email_verified:=true; confirmation_method:='email_code';
    end if;
  end if;
  select * into previous from public.legal_current_state where document_id=d.id and beneficiary_id=p.beneficiary_id
    and scope_key=coalesce(p.club_id::text,'platform') for update;
  if found and previous.conflict and p_decision in ('accepted','authorized','consented') then raise exception 'Withdrawal conflict requires review'; end if;
  insert into public.legal_decisions(presentation_id,actor_id,beneficiary_id,document_id,version_id,club_id,
    decision,rendered_snapshot,rendered_sha256,authority_snapshot,idempotency_key)
  values(p.id,p_actor,p.beneficiary_id,d.id,p.version_id,p.club_id,p_decision,p.rendered_snapshot,p.rendered_sha256,
    jsonb_build_object('role',p.actor_role,'authority',p.authority,'parent_email_confirmed',parent_email_verified,
      'confirmation_method',confirmation_method),p_key)
  returning id into event_id;
  insert into public.legal_current_state(document_id,beneficiary_id,club_scope,version_id,decision_id,decision,decided_at,conflict)
  values(d.id,p.beneficiary_id,p.club_id,p.version_id,event_id,p_decision,now(),p_decision='withdrawn' or (d.kind='parent_authorization' and p_decision='refused'))
  on conflict(document_id,beneficiary_id,scope_key) do update set version_id=excluded.version_id,decision_id=excluded.decision_id,
    decision=excluded.decision,decided_at=excluded.decided_at,
    conflict=case when excluded.conflict then true else legal_current_state.conflict end;
  return event_id;
end $function$
;

commit;
