-- Read-only follow-up on isolated TEST after postflight 15.
-- Inspect the exact deployed functions and their callers before changing OM privileges.
with selected_signatures(signature) as (values
  ('public.save_player_golf_hole_transactional(uuid,jsonb)'),
  ('public.save_player_golf_holes_transactional(uuid,jsonb)'),
  ('public.update_player_golf_round_transactional(uuid,timestamp with time zone,text,text,smallint,text,integer,numeric,integer,jsonb)'),
  ('public.om_recompute_round(uuid)')
), selected_functions as (
  select 'golf_rpc'::text as category,s.signature as item,
    jsonb_build_object('present',p.oid is not null,'security_definer',p.prosecdef,
      'owner',pg_get_userbyid(p.proowner),
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'definition',pg_get_functiondef(p.oid)) as details
  from selected_signatures s left join pg_proc p on p.oid=to_regprocedure(s.signature)
), trigger_callers as (
  select 'golf_trigger'::text as category,c.relname||' / '||t.tgname as item,
    jsonb_build_object('trigger',pg_get_triggerdef(t.oid),
      'function',t.tgfoid::regprocedure::text,'security_definer',p.prosecdef,
      'owner',pg_get_userbyid(p.proowner),
      'definition',pg_get_functiondef(t.tgfoid)) as details
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
  where not t.tgisinternal and t.tgrelid in ('public.golf_rounds'::regclass,'public.golf_round_holes'::regclass)
    and position('om_recompute_round' in lower(pg_get_functiondef(t.tgfoid)))>0
), routine_callers as (
  select 'routine_caller'::text as category,p.oid::regprocedure::text as item,
    jsonb_build_object('security_definer',p.prosecdef,'owner',pg_get_userbyid(p.proowner),
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) as details
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname<>'om_recompute_round'
    and position('om_recompute_round(' in lower(p.prosrc))>0
)
select category,item,details from selected_functions
union all select category,item,details from trigger_callers
union all select category,item,details from routine_callers
order by category,item;
