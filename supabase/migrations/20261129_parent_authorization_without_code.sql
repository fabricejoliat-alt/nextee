-- A signed-in, email-confirmed Parent may authorize a linked junior without an email code.
-- Other child-specific consents keep their existing email-code challenge.
begin;

alter table public.legal_parent_code_control alter column required set default false;
insert into public.legal_parent_code_control(singleton, required, updated_at)
values (true, false, now())
on conflict (singleton) do update set required = false, updated_at = now();

do $migration$
declare
  definition text;
  email_guard text := 'and nullif(btrim(u.email),'''') is not null';
begin
  select pg_get_functiondef(to_regprocedure('public.decide_legal_document(uuid,uuid,text,uuid,text)'))
    into definition;
  if definition is null then raise exception 'Legal decision function unavailable'; end if;
  if position('verified_parent_account' in definition) = 0 then
    if position('temporarily_waived' in definition) = 0 or position(email_guard in definition) = 0 then
      raise exception 'Unexpected legal decision function; no policy change applied';
    end if;
    definition := replace(definition, 'temporarily_waived', 'verified_parent_account');
    definition := replace(definition, email_guard,
      email_guard || ' and lower(btrim(u.email)) not like ''%@noemail.local''');
    execute definition;
  end if;
  if position('verified_parent_account' in
      pg_get_functiondef('public.decide_legal_document(uuid,uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception 'Parent confirmation evidence update failed';
  end if;
end $migration$;

commit;
