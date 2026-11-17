-- Extend verified-account confirmation to parent decisions on optional AI consents.
-- Keep representation, current document/version, confirmed email and audit checks.
begin;
do $migration$
declare
  definition text;
  old_condition text := 'if d.kind=''parent_authorization'' and d.purpose_key=''service.parent_authorization'' and not code_required then';
  new_condition text := 'if not code_required and ((d.kind=''parent_authorization'' and d.purpose_key=''service.parent_authorization'') or (d.kind=''specific_consent'' and d.purpose_key in (''coaching.ai'',''coaching.rewrite'') and p.actor_role=''parent'' and p.authority=''verified_representative'')) then';
begin
  select pg_get_functiondef(to_regprocedure('public.decide_legal_document(uuid,uuid,text,uuid,text)')) into definition;
  if definition is null or position('verified_parent_account' in definition)=0
    or position('legal_document_actor_allowed' in definition)=0
    or position('parent_email_verified' in definition)=0
    or position('not like ''%@noemail.local''' in definition)=0 then
    raise exception 'Unexpected legal decision function; no policy change applied';
  end if;
  if position(new_condition in definition)=0 then
    if position(old_condition in definition)=0 then raise exception 'Parent confirmation branch unavailable'; end if;
    execute replace(definition,old_condition,new_condition);
  end if;
end $migration$;
update public.legal_parent_code_control set required=false,updated_at=now() where singleton;
commit;
