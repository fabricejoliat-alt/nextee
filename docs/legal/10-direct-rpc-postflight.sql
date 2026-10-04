-- Read-only postflight after 20261023_legal_direct_rpc_privileges.sql on TEST.
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'save_coach_training_debrief','save_coach_training_debrief_v2',
  'validate_coach_training_private_notes')
order by p.proname,arguments;
-- Expected for each of the three rows: false, false, true.
