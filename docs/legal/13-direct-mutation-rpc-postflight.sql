-- Read-only postflight after 20261026_legal_direct_mutation_rpc_gate.sql on isolated TEST.
-- Every public wrapper must be callable by authenticated, every business function only by service_role.
with functions(signature,kind) as (values
  ('public.create_coach_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)','wrapper'),
  ('public.create_coach_events_v1_business(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)','business'),
  ('public.create_manager_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])','wrapper'),
  ('public.create_manager_events_v1_business(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb,uuid[])','business'),
  ('public.create_player_golf_rounds_transactional(uuid,jsonb,timestamptz[],jsonb)','wrapper'),
  ('public.create_player_golf_rounds_transactional_business(uuid,jsonb,timestamptz[],jsonb)','business'),
  ('public.set_player_performance_mode(uuid,uuid,boolean)','wrapper'),
  ('public.set_player_performance_mode_business(uuid,uuid,boolean)','business'))
select f.signature,f.kind,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  case when f.kind='wrapper' then position('legal_required_' in pg_get_functiondef(p.oid))>0 else null end as checks_legal_gate,
  (select enabled from public.legal_enforcement_control where singleton=true) as legal_gate_enabled,
  (select count(*) from public.legal_documents where active) as active_legal_documents
from functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
order by f.signature;
