-- An existing, editable organization parent/child link is sufficient to decide.
-- No representation assertions or consent decisions are manufactured here.
begin;

do $migration$
declare
  definition text;
  old_guard text := 'and exists(select 1 from public.legal_representative_assertions a where a.guardian_id=p_actor and a.child_id=p_beneficiary and a.club_id=p_club and a.status=''verified'')';
  new_guard text := 'and exists(select 1 from public.player_guardians g where g.guardian_user_id=p_actor and g.player_id=p_beneficiary and (g.relation in (''parent'',''father'',''mother'',''legal_guardian'') or exists(select 1 from public.legal_representative_assertions a where a.guardian_id=p_actor and a.child_id=p_beneficiary and a.club_id=p_club and a.status=''verified'')))';
  old_authority text := 'when public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) then ''verified_representative''';
  new_authority text := 'when exists(select 1 from public.legal_representative_assertions a where a.guardian_id=p_actor and a.child_id=p_beneficiary and a.club_id=d.club_id and a.status=''verified'') then ''verified_representative''';
  old_confirmation text := 'and p.authority=''verified_representative''';
  new_confirmation text := 'and p.authority in (''verified_representative'',''club_linked_parent'')';
begin
  definition := pg_get_functiondef('public.legal_actor_allowed(uuid,uuid,uuid,text)'::regprocedure);
  if strpos(definition,'organization_guardian_allowed(p_actor,p_beneficiary,p_club,true,true)')=0
    or strpos(definition,'organization_members')=0 then
    raise exception 'Unexpected parent permission function; no changes applied';
  end if;
  if strpos(definition,new_guard)=0 then
    if strpos(definition,old_guard)=0 then raise exception 'Parent representation guard changed'; end if;
    execute replace(definition,old_guard,new_guard);
  end if;

  -- Preserve the distinction in immutable evidence: organization link versus
  -- an actual historical manual review. Existing evidence remains unchanged.
  definition := pg_get_functiondef('public.present_legal_document(uuid,uuid,uuid,text,text)'::regprocedure);
  if strpos(definition,'legal_document_actor_allowed')=0 or strpos(definition,'legal_version_matches_document')=0 then
    raise exception 'Unexpected parent presentation function';
  end if;
  if strpos(definition,new_authority)=0 then
    if strpos(definition,old_authority)=0 then raise exception 'Parent presentation authority changed'; end if;
    execute replace(definition,old_authority,new_authority);
  end if;

  definition := pg_get_functiondef('public.decide_legal_document(uuid,uuid,text,uuid,text)'::regprocedure);
  if strpos(definition,'verified_parent_account')=0 or strpos(definition,'legal_document_actor_allowed')=0
    or strpos(definition,'parent_email_verified')=0 then
    raise exception 'Unexpected parent decision function';
  end if;
  if strpos(definition,new_confirmation)=0 then
    if strpos(definition,old_confirmation)=0 then raise exception 'Parent account confirmation changed'; end if;
    execute replace(definition,old_confirmation,new_confirmation);
  end if;
end $migration$;

-- CREATE OR REPLACE above preserves ownership and existing service-only ACLs.
commit;
