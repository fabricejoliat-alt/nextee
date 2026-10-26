begin;

-- A confirmed parent need not be labelled father or mother. This does not
-- verify legal representation or submit any authorization decision.
alter table public.player_guardians drop constraint player_guardians_relation_check;
alter table public.player_guardians add constraint player_guardians_relation_check
  check (relation in ('parent','mother','father','legal_guardian','other'));

-- Preserve the current organization/identity/access guards and function ACLs.
-- Fail closed if a routine's reviewed relationship validation has changed.
do $migration$
declare
  signature text;
  definition text;
  old_choices text;
  new_choices text;
begin
  foreach signature in array array[
    'public.legal_document_actor_allowed(uuid,uuid,uuid,text)',
    'public.manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean)',
    'public.provision_academy_family_checked(uuid,uuid,uuid,jsonb,uuid,jsonb,text,uuid)',
    'public.attach_academy_guardian_checked(uuid,uuid,uuid,text)',
    'public.provision_academy_guardian_checked(uuid,uuid,uuid,jsonb,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if signature like '%manage_player_guardian_v1%' or signature like '%attach_academy_guardian_checked%' then
      old_choices := '(''mother'',''father'',''legal_guardian'',''other'')';
      new_choices := '(''parent'',''mother'',''father'',''legal_guardian'',''other'')';
    else
      old_choices := '(''father'',''mother'',''legal_guardian'')';
      new_choices := '(''parent'',''father'',''mother'',''legal_guardian'')';
    end if;
    if strpos(definition,new_choices)>0 and strpos(definition,old_choices)=0 then
      continue; -- Already applied; no changes to existing function ownership/ACLs.
    end if;
    if (length(definition)-length(replace(definition,old_choices,'')))/length(old_choices) <> 1 then
      raise exception 'Relationship validation changed in %',signature;
    end if;
    execute replace(definition,old_choices,new_choices);
  end loop;
end $migration$;

commit;
