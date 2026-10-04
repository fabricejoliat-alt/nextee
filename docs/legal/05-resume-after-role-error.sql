-- Recovery only if the SQL editor committed statements before the 42883 error.
-- First run the read-only probe in docs/legal/04-recovery-probe.sql.
-- Requires legal_documents and legal_presentations to exist; never run against an unverified database.
-- This script adds/replaces only the three functions after the failed statement.

create or replace function public.legal_actor_allowed(p_actor uuid,p_beneficiary uuid,p_club uuid,p_role text)
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
