-- Read-only postflight after 20261024_legal_direct_table_gate.sql on isolated TEST.
-- One grid. The control must be false and the inactive constraint present.
with table_names(name) as (values
  ('club_events'),('club_event_attendees'),('coach_groups'),('coach_group_players'),
  ('marketplace_items'),('training_sessions'),('training_session_items'),
  ('golf_rounds'),('golf_round_holes')),
policy_rows as (
  select 'policy'::text as category,t.name as item,
    jsonb_build_object('present',p.polname is not null,'restrictive',p.polpermissive=false,
      'rls_enabled',c.relrowsecurity,'command',p.polcmd) as details
  from table_names t left join pg_class c on c.oid=to_regclass('public.'||t.name)
  left join pg_policy p on p.polrelid=c.oid and p.polname='legal_required_direct_access'
), function_rows as (
  select 'function'::text as category,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as item,
    jsonb_build_object('security_definer',p.prosecdef,
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) as details
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'legal_required_direct_access','legal_required_event_access',
    'legal_required_group_access','legal_required_session_access')
)
select 'control'::text as category,'legal_enforcement_control'::text as item,
  jsonb_build_object('enabled',(select enabled from public.legal_enforcement_control where singleton=true),
    'inactive_constraint',exists(select 1 from pg_constraint
      where conrelid='public.legal_enforcement_control'::regclass
        and conname='legal_enforcement_control_inactive'),
    'anon_select',has_table_privilege('anon','public.legal_enforcement_control','SELECT'),
    'authenticated_select',has_table_privilege('authenticated','public.legal_enforcement_control','SELECT'),
    'disabled_gate_allows',public.legal_required_direct_access(),
    'active_documents',(select count(*) from public.legal_documents where active)) as details
union all select category,item,details from policy_rows
union all select category,item,details from function_rows
order by category,item;
