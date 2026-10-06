-- TEST ONLY, project wizbeuuvjibmmuxyynly. Reversible temporary setting.
-- To restore: update public.legal_parent_code_control set required=true,updated_at=now() where singleton;
begin;
update public.legal_parent_code_control set required=false,updated_at=now() where singleton and required=true;
commit;
