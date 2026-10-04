-- Read-only audit on isolated TEST. One result grid; export it as CSV if needed.
-- An HTTP proxy cannot block direct PostgREST, RPC or Storage requests made with a valid session.
with policy_rows as (
  select 'policy'::text as category,n.nspname||'.'||c.relname||' / '||coalesce(p.polname,'[no policy]') as item,
    jsonb_build_object('rls_enabled',c.relrowsecurity,'command',p.polcmd,
      'using',pg_get_expr(p.polqual,p.polrelid),'with_check',pg_get_expr(p.polwithcheck,p.polrelid)) as details
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  left join pg_policy p on p.polrelid=c.oid
  where (n.nspname='public' and c.relname in (
    'profiles','club_members','clubs','player_guardians','club_events','club_event_attendees',
    'training_sessions','training_session_items','golf_rounds','golf_round_holes',
    'coach_groups','coach_group_players','marketplace_items','player_documents',
    'player_consents','player_consent_history','legal_current_state'))
    or (n.nspname='storage' and c.relname='objects')
), grant_rows as (
  select 'grant'::text as category,table_schema||'.'||table_name||' / '||grantee as item,
    jsonb_build_object('privilege',privilege_type) as details
  from information_schema.role_table_grants
  where grantee in ('anon','authenticated')
    and ((table_schema='public' and table_name in (
      'profiles','club_members','club_events','club_event_attendees','training_sessions',
      'golf_rounds','coach_groups','coach_group_players','marketplace_items','player_documents'))
      or (table_schema='storage' and table_name='objects'))
), rpc_rows as (
  select 'definer_rpc'::text as category,n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as item,
    jsonb_build_object('anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) as details
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and (has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('authenticated',p.oid,'EXECUTE'))
)
select 'environment'::text as category,current_database()::text as item,
  jsonb_build_object('database_role',current_user,'active_legal_documents',
    (select count(*) from public.legal_documents where active)) as details
union all select category,item,details from policy_rows
union all select category,item,details from grant_rows
union all select category,item,details from rpc_rows
order by category,item;
