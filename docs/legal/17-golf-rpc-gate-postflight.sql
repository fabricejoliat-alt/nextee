-- Read-only postflight after 20261028_legal_golf_rpc_gate.sql on isolated TEST.
-- Public names keep their signatures; business functions must have no client EXECUTE.
with functions(signature,kind) as (values
  ('public.om_recompute_round(uuid)','wrapper'),
  ('public.om_recompute_round_business(uuid)','business'),
  ('public.save_player_golf_hole_transactional(uuid,jsonb)','wrapper'),
  ('public.save_player_golf_hole_transactional_business(uuid,jsonb)','business'),
  ('public.save_player_golf_holes_transactional(uuid,jsonb)','wrapper'),
  ('public.save_player_golf_holes_transactional_business(uuid,jsonb)','business'),
  ('public.update_player_golf_round_transactional(uuid,timestamptz,text,text,smallint,text,integer,numeric,integer,jsonb)','wrapper'),
  ('public.update_player_golf_round_transactional_business(uuid,timestamptz,text,text,smallint,text,integer,numeric,integer,jsonb)','business'))
select f.signature,f.kind,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  case when f.kind='wrapper' then position('legal_required_direct_access' in pg_get_functiondef(p.oid))>0 else null end as checks_legal_gate,
  case when f.signature='public.om_recompute_round(uuid)' then
    position('player_guardians' in pg_get_functiondef(p.oid))>0 else null end as checks_round_access,
  (select enabled from public.legal_enforcement_control where singleton=true) as legal_gate_enabled,
  (select count(*) from public.legal_documents where active) as active_legal_documents
from functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
order by f.signature;
